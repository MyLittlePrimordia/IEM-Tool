// Photo background remover - u2netp matte via ONNX Runtime Web.
//
// Replaces the old processWhiteBgRemoval flood-fill. That approach decided
// "background" from pixel brightness, so it could not tell a white backdrop
// from a white highlight on the product, and its brightness->alpha ramp ran over
// every pixel in the image, punching pale detail out of the subject and
// compositing it darker over the dark export card.
//
// u2netp is a real saliency model, so the matte is a per-pixel confidence
// rather than a brightness guess, and only ALPHA is written - RGB is never
// touched, which is why the darkening cannot come back.
//
// State is stored as an OPERATION LOG, not as pixels:
//
//     matte = strengthCurve( modelMask  minus  union(fill seeds) )
//
// Because a fill is just a seed, undo is "pop the last seed and recomposite" -
// a few-millisecond pixel pass, no inference, no snapshot buffers, and no
// memory ceiling on how many times the user can undo. Strength changes
// re-derive from the same log, so undo survives moving the slider.
//
// Attaches to IEM_Module so it can override preProcessImage and
// toggleBgRemoval, which live there. The old processWhiteBgRemoval it replaces
// has been deleted rather than shadowed - leaving it would be dead code that
// still looked callable.
const IEM_PhotoMatteMethods = {

    // ---------------------------------------------------------------- session

    /* Bring in the ORT runtime on first use rather than from a <script> tag in
       index.html. Two reasons: the photo tab is the only consumer, so loading
       142KB of runtime (and later a 10.5MB wasm and a 4.4MB model) on every
       app start is wasted; and a blocking script in front of the bundle sits on
       the critical path for the whole UI, which showed up as a responsive
       breakpoint assertion losing its race in verify:ui. */
    loadPhotoMatteRuntime: function() {
        if (typeof window !== 'undefined' && window.ort) return Promise.resolve(window.ort);
        if (this._matteRuntimePromise) return this._matteRuntimePromise;
        const self = this;
        this._matteRuntimePromise = new Promise(function(resolve, reject) {
            const el = document.createElement('script');
            el.src = 'app/js/vendor/ort.wasm.min.js';
            el.async = false;
            el.onload = function() {
                if (window.ort) resolve(window.ort);
                else reject(new Error('ONNX Runtime script loaded but did not define window.ort'));
            };
            el.onerror = function() { reject(new Error('Could not load app/js/vendor/ort.wasm.min.js')); };
            document.head.appendChild(el);
        });
        const clear = function() { self._matteRuntimePromise = null; };
        this._matteRuntimePromise.then(clear, clear);
        return this._matteRuntimePromise;
    },

    /* Load the u2netp session once and keep it.
       ORT picks between four .wasm filenames at runtime based on SIMD and
       thread support; numThreads/simd are pinned so exactly one file is ever
       requested (ort-wasm-simd.wasm). Threads would need COOP/COEP
       cross-origin isolation, which this app's local server does not send. */
    ensurePhotoMatteSession: function(onProgress) {
        if (this._matteSession) return Promise.resolve(this._matteSession);
        if (this._matteSessionPromise) return this._matteSessionPromise;

        const self = this;

        this._matteSessionPromise = (async function() {
            if (onProgress) onProgress(0, 'Loading background model');
            const ort = await self.loadPhotoMatteRuntime();
            if (typeof ort === 'undefined') throw new Error('ONNX Runtime is not available');

            ort.env.wasm.wasmPaths = 'app/js/vendor/';
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            const res = await fetch('app/models/u2netp.onnx');
            if (!res.ok) throw new Error('Could not read u2netp.onnx (HTTP ' + res.status + ')');
            const buf = await res.arrayBuffer();
            if (onProgress) onProgress(0.6, 'Loading background model');
            // Tensor names in this export are "input.1" and "1959", NOT
            // "input" - read them off the session rather than hardcoding.
            const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
            self._matteSession = session;
            if (onProgress) onProgress(1, 'Model ready');
            return session;
        })();

        // A failed load must not poison every later attempt.
        const clear = function() { self._matteSessionPromise = null; };
        this._matteSessionPromise.then(clear, clear);
        return this._matteSessionPromise;
    },

    /* True once the model is resident, so the UI can skip the loading state. */
    isPhotoMatteReady: function() {
        return !!this._matteSession;
    },

    /* Frees the WASM heap. The session is a few tens of MB and there is no
       reason to hold it once the user is done with the photo. */
    releasePhotoMatte: function() {
        if (this._matteSession) {
            try { this._matteSession.release(); } catch (e) { /* already gone */ }
        }
        this._matteSession = null;
        this._matteSessionPromise = null;
        this._matteBaseMask = null;
        this._matteFills = [];
        this._matteRedoStack = [];
        this._matteStrength = 0.5;
    },

    // ------------------------------------------------------------- inference

    /* Run u2netp over a canvas and return an alpha mask at that canvas's size.

       The source app squashes any input into 320x320 with drawImage(img,0,0,S,S),
       which distorts every non-square photo and then stretches the mask back.
       Here the image is letterboxed into the square instead - padded with white,
       because product photography is on white - and the mask is cropped and
       resampled to match. The model sees undistorted pixels and the matte lines
       up with the original. */
    inferPhotoMatte: async function(sourceCanvas) {
        const session = await this.ensurePhotoMatteSession();
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        if (!w || !h) throw new Error('Nothing to analyse');

        const SIZE = 320;
        const box = IEM_PhotoMatte_letterbox(sourceCanvas, SIZE);
        const px = box.data;
        const innerW = box.innerW, innerH = box.innerH, x0 = box.x0, y0 = box.y0;

        // u2netp/silueta expect ImageNet normalisation, CHW, float32.
        const meanR = 0.485, meanG = 0.456, meanB = 0.406;
        const stdR = 0.229, stdG = 0.224, stdB = 0.225;
        const plane = SIZE * SIZE;
        const data = new Float32Array(3 * plane);
        for (let i = 0; i < plane; i++) {
            data[i] = (px[i * 4] / 255 - meanR) / stdR;
            data[i + plane] = (px[i * 4 + 1] / 255 - meanG) / stdG;
            data[i + 2 * plane] = (px[i * 4 + 2] / 255 - meanB) / stdB;
        }

        const ort = window.ort;
        const tensor = new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
        const results = await session.run({ [session.inputNames[0]]: tensor });
        const out = results[session.outputNames[0]];
        const md = out.data;

        // This export already emits a 0..1 mask, but sigmoid when the output
        // looks like logits, so a differently-quantised model cannot silently
        // produce a black or white matte.
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < md.length; i++) { if (md[i] < mn) mn = md[i]; if (md[i] > mx) mx = md[i]; }
        const needsSigmoid = mn < -0.1 || mx > 1.1;

        // Crop the letterboxed square back out. BOTH offsets are required: the
        // image is centred, so landscape photos have y0 rows of padding on top
        // and portrait photos have x0 columns on the left. Dropping y0 here
        // shifts the whole matte down by y0/scale source pixels on landscape
        // photos while leaving portrait ones looking fine.
        const src = new Float32Array(innerW * innerH);
        for (let y = 0; y < innerH; y++) {
            for (let x = 0; x < innerW; x++) {
                const si = (y0 + y) * SIZE + (x0 + x);
                let v = md[si];
                if (needsSigmoid) v = 1 / (1 + Math.exp(-v));
                src[y * innerW + x] = v;
            }
        }

        return IEM_PhotoMatte_resizeMask(src, innerW, innerH, w, h);
    },

    // -------------------------------------------------------------- compositing

    /* Rebuild processedCanvas from base mask + fill log + strength.
       This is the only place the matte is materialised, and it is cheap enough
       to re-run on every slider tick, fill, undo and redo. */
    compositePhotoMatte: function() {
        if (!this._matteSourceCanvas || !this._matteBaseMask) return null;

        const src = this._matteSourceCanvas;
        const w = src.width, h = src.height;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const octx = out.getContext('2d', { willReadFrequently: true });
        octx.drawImage(src, 0, 0);
        const img = octx.getImageData(0, 0, w, h);

        // The fill log is replayed through regionGrow, which indexes colour as
        // rgb[i * 3]. img.data is RGBA - four bytes per pixel - so handing it
        // over directly makes every sample read the wrong channel and shift by
        // one pixel per step. The colour test then rejects the fill's own
        // pixels and the fill silently does nothing, which is exactly the bug
        // this used to have. Read a packed RGB buffer instead.
        //
        // Cached per source canvas because the photo's colours cannot change
        // while it is loaded: this runs on every slider tick, and re-reading
        // the pixels each time made a drag cost a full getImageData per frame.
        if (this._matteRGBSource !== src) {
            this._matteRGBSource = src;
            this._matteRGB = IEM_PhotoMatte_sourceRGB(src, w, h);
        }
        const rgb = this._matteRGB;

        const mask = new Uint8ClampedArray(this._matteBaseMask);

        // Replay the operation log. Already-transparent pixels stay passable so
        // a chain of clicks can grow across a removed region into adjacent
        // background the model missed.
        for (let f = 0; f < this._matteFills.length; f++) {
            const seed = this._matteFills[f];
            IEM_PhotoMatte_regionGrow(mask, rgb, w, h, seed.x, seed.y);
        }

        IEM_PhotoMatte_applyStrength(mask, this._matteStrength);

        const d = img.data;
        for (let i = 0, p = 3; i < mask.length; i++, p += 4) d[p] = mask[i];
        octx.putImageData(img, 0, 0);

        this.processedCanvas = out;
        return out;
    },

    /* Entry point for the toggle: analyse, composite, repaint.
       Guarded so a second toggle or a rapid photo change cannot start a second
       inference while one is in flight - the stale result would otherwise land
       on top of the newer photo. */
    applyPhotoMatte: async function() {
        if (!this._matteSourceCanvas) return;
        if (this._matteBusy) return;
        const self = this;
        const source = this._matteSourceCanvas;
        this._matteBusy = true;
        if (typeof this.updatePhotoMatteControls === 'function') this.updatePhotoMatteControls();
        try {
            const mask = await this.inferPhotoMatte(source);
            // The user may have cleared or swapped the photo mid-inference.
            if (self._matteSourceCanvas !== source) return;
            self._matteBaseMask = mask;
            self._matteFills = [];
            self._matteRedoStack = [];
            self.compositePhotoMatte();
            self.renderImagePreview();
        } catch (err) {
            console.error('Background removal failed:', err);
            if (typeof showToast === 'function') {
                showToast('Background removal failed: ' + (err && err.message ? err.message : err), '⚠️');
            }
        } finally {
            self._matteBusy = false;
            if (typeof self.updatePhotoMatteControls === 'function') self.updatePhotoMatteControls();
        }
    },

    // ------------------------------------------------------------------ controls

    setPhotoMatteStrength: function(value) {
        const v = Math.max(0, Math.min(1, parseFloat(value)));
        if (!isFinite(v)) return;
        this._matteStrength = (this._matteStrength === undefined || this._matteStrength === null) ? 0.5 : this._matteStrength;
        if (Math.abs(v - this._matteStrength) < 0.001) return;
        this._matteStrength = v;
        if (this._matteBaseMask) {
            this.compositePhotoMatte();
            this.renderImagePreview();
        }
    },

    getPhotoMatteStrength: function() {
        return (this._matteStrength === undefined || this._matteStrength === null) ? 0.5 : this._matteStrength;
    },

    /* Double-click fill. Only ever REMOVES; there is no restore mode, because
       one undo step covers a mis-click and a second tool doubles the surface
       area of the control bar for a case that undo already handles. */
    addPhotoMatteFill: function(x, y) {
        if (!this._matteBaseMask) return 0;
        const w = this._matteSourceCanvas.width, h = this._matteSourceCanvas.height;
        if (x < 0 || y < 0 || x >= w || y >= h) return 0;

        this._matteFills = this._matteFills || [];
        this._matteRedoStack = this._matteRedoStack || [];
        const before = this._matteBaseMask;
        // Same cached packed-RGB buffer compositePhotoMatte uses. The two must
        // agree: if they read colour differently, a fill would register here
        // and then vanish on the next composite, or vice versa.
        if (this._matteRGBSource !== this._matteSourceCanvas) {
            this._matteRGBSource = this._matteSourceCanvas;
            this._matteRGB = IEM_PhotoMatte_sourceRGB(this._matteSourceCanvas, w, h);
        }
        const rgb = this._matteRGB;
        const probe = new Uint8ClampedArray(this._matteBaseMask);
        for (let f = 0; f < this._matteFills.length; f++) {
            const s = this._matteFills[f];
            IEM_PhotoMatte_regionGrow(probe, rgb, w, h, s.x, s.y);
        }
        const removed = IEM_PhotoMatte_regionGrow(probe, rgb, w, h, x, y);
        if (removed === 0) return 0;

        this._matteFills.push({ x: x, y: y });
        this._matteRedoStack.length = 0;
        this.compositePhotoMatte();
        this.renderImagePreview();
        return removed;
    },

    canUndoPhotoMatte: function() { return (this._matteFills && this._matteFills.length > 0); },
    canRedoPhotoMatte: function() { return (this._matteRedoStack && this._matteRedoStack.length > 0); },

    undoPhotoMatte: function() {
        if (!this.canUndoPhotoMatte()) return false;
        this._matteRedoStack.push(this._matteFills.pop());
        this.compositePhotoMatte();
        this.renderImagePreview();
        return true;
    },

    redoPhotoMatte: function() {
        if (!this.canRedoPhotoMatte()) return false;
        this._matteFills.push(this._matteRedoStack.pop());
        this.compositePhotoMatte();
        this.renderImagePreview();
        return true;
    },

    /* Discard manual fills but keep the model matte. The re-analyse button does
       not call this - it re-runs the model instead - but it is the primitive to
       reach for when the matte is good and only the fills are wrong. */
    resetPhotoMatteFills: function() {
        if (!this._matteFills || this._matteFills.length === 0) return false;
        this._matteFills = [];
        this._matteRedoStack = [];
        this.compositePhotoMatte();
        this.renderImagePreview();
        return true;
    },

    /* ------------------------------------------------------------ UI wiring
       Every DOM concern lives here rather than in the maths above, so the mask
       pipeline stays testable in isolation (verify-photo-matte.js exercises
       these same methods with no DOM at all). */

    /* Single place that decides what the photo bar looks like. Called from
       toggle, apply (start and end), fills, undo/redo, strength and clear.
       Idempotent: it reads state and writes the DOM to match, so calling it
       twice cannot drift. */
    updatePhotoMatteControls: function() {
        const active = !!this.removeWhiteBg;
        const busy = this.isPhotoMatteBusy();
        // Rebinding the slider changes its value without firing `input`, so the
        // --range-fill that paints the coloured track would keep the ZOOM
        // percentage. The knob would jump to 50% while the fill stayed at
        // whatever the zoom was - the "knob not connected to the bar" symptom.
        const refreshFill = (el) => {
            if (el && typeof window !== 'undefined' && typeof window.IEM_updateRangeFill === 'function') {
                window.IEM_updateRangeFill(el);
            }
        };

        // Contextual buttons: present only while the feature is on, so the
        // default photo bar is untouched for everyone who does not use it.
        ['photo-matte-rerun', 'photo-matte-undo', 'photo-matte-redo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !active);
        });
        const rerun = document.getElementById('photo-matte-rerun');
        if (rerun) rerun.disabled = busy || !this._matteSourceCanvas;
        const undo = document.getElementById('photo-matte-undo');
        if (undo) undo.disabled = busy || !this.canUndoPhotoMatte();
        const redo = document.getElementById('photo-matte-redo');
        if (redo) redo.disabled = busy || !this.canRedoPhotoMatte();

        // Slider meaning swap. The zoom range is remembered on first bind and
        // restored on unbind, so a round trip through the feature does not
        // leave the slider at 0..100 and silently clamp the zoom to 5.
        const slider = document.getElementById('image-zoom-slider');
        const icon = document.getElementById('image-slider-icon');
        if (slider) {
            if (active) {
                if (slider.dataset.matteBound !== '1') {
                    slider.dataset.zoomMin = slider.min;
                    slider.dataset.zoomMax = slider.max;
                    slider.dataset.zoomStep = slider.step;
                    slider.dataset.matteBound = '1';
                    slider.min = '0';
                    slider.max = '100';
                    slider.step = '1';
                }
                slider.value = String(Math.round(this.getPhotoMatteStrength() * 100));
                slider.setAttribute('data-tooltip', '✂️ Edge strength');
                refreshFill(slider);
            } else if (slider.dataset.matteBound === '1') {
                delete slider.dataset.matteBound;
                slider.min = slider.dataset.zoomMin;
                slider.max = slider.dataset.zoomMax;
                slider.step = slider.dataset.zoomStep;
                delete slider.dataset.zoomMin;
                delete slider.dataset.zoomMax;
                delete slider.dataset.zoomStep;
                slider.value = String(this.imgScale);
                slider.setAttribute('data-tooltip', '🔍 Zoom the image');
                refreshFill(slider);
            }
        }
        if (icon) icon.textContent = active ? '✂️' : '🔍';

        const container = document.getElementById('image-preview-container');
        if (container) container.classList.toggle('is-matte-target', active && !busy);

        const status = document.getElementById('photo-matte-status');
        if (status) {
            if (!active) {
                status.classList.add('hidden');
                status.classList.remove('is-busy', 'is-error');
                status.textContent = '';
            } else if (busy) {
                status.classList.remove('hidden');
                status.classList.add('is-busy');
                status.classList.remove('is-error');
                status.textContent = this.isPhotoMatteReady() ? 'Analyzing…' : 'Loading model…';
            } else {
                status.classList.add('hidden');
                status.classList.remove('is-busy');
                status.textContent = '';
            }
        }
    },

    /* Invert the preview transform to find which pixel was clicked.
       renderImagePreviewInternal stores the exact geometry it drew with, so this
       does not re-derive the contain-fit: a second copy of that arithmetic
       would be free to drift, and the symptom would be fills landing in the
       wrong place after a resize instead of failing. */
    handlePhotoMatteDoubleClick: function(ev) {
        if (!this.removeWhiteBg || this.isPhotoMatteBusy()) return;
        const geo = this._photoDrawRect;
        const src = this._matteSourceCanvas;
        if (!geo || !src || !this._matteBaseMask) return;

        const canvasRect = geo.canvas.getBoundingClientRect();
        if (!canvasRect.width || !canvasRect.height) return;
        // Client px -> backing-store px. The canvas is sized from its parent's
        // box, so normalising through its own rect keeps the two in step even
        // if they ever stop matching.
        const nx = (ev.clientX - canvasRect.left) / canvasRect.width * geo.cw;
        const ny = (ev.clientY - canvasRect.top) / canvasRect.height * geo.ch;

        const px = (nx - (geo.cw / 2 + geo.offX)) / geo.scale + geo.drawW / 2;
        const py = (ny - (geo.ch / 2 + geo.offY)) / geo.scale + geo.drawH / 2;

        const ix = Math.floor(px / geo.drawW * src.width);
        const iy = Math.floor(py / geo.drawH * src.height);
        if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) return;

        if (this.addPhotoMatteFill(ix, iy)) this.flashPhotoMatteTarget();
        this.updatePhotoMatteControls();
    },

    /* Brief accent ring so a precision double-click registers visually - the
       fill can be a handful of pixels and is easy to miss. */
    flashPhotoMatteTarget: function() {
        const el = document.getElementById('image-preview-container');
        if (!el) return;
        el.classList.add('is-matte-pulse');
        clearTimeout(this._mattePulseTimer);
        this._mattePulseTimer = setTimeout(() => el.classList.remove('is-matte-pulse'), 220);
    },

    /* Re-run the model. Also the way to throw away manual fills, which is why
       it is its own button instead of something you do by toggling off and on. */
    rerunPhotoMatte: function() {
        if (!this.removeWhiteBg || !this._matteSourceCanvas) return;
        if (this.isPhotoMatteBusy()) return;
        this.applyPhotoMatte();
    },

    undoPhotoMatteUI: function() {
        const r = this.undoPhotoMatte();
        this.updatePhotoMatteControls();
        return r;
    },
    redoPhotoMatteUI: function() {
        const r = this.redoPhotoMatte();
        this.updatePhotoMatteControls();
        return r;
    },

    /* One-time listener attachment. Direct listeners rather than data-action
       dispatch: these are photo-only affordances and adding entries to the
       generated handler table would make a JS-only control depend on a
       generated file staying in sync. */
    wirePhotoMatteUI: function() {
        if (this._matteUIWired) return;
        this._matteUIWired = true;
        const self = this;

        const container = document.getElementById('image-preview-container');
        if (container) {
            container.addEventListener('dblclick', function(ev) {
                self.handlePhotoMatteDoubleClick(ev);
            });
        }
        const rerun = document.getElementById('photo-matte-rerun');
        if (rerun) rerun.addEventListener('click', function() { self.rerunPhotoMatte(); });
        const undo = document.getElementById('photo-matte-undo');
        if (undo) undo.addEventListener('click', function() { self.undoPhotoMatteUI(); });
        const redo = document.getElementById('photo-matte-redo');
        if (redo) redo.addEventListener('click', function() { self.redoPhotoMatteUI(); });

        document.addEventListener('keydown', function(ev) {
            if (!self.removeWhiteBg) return;
            if ((ev.key || '').toLowerCase() !== 'z') return;
            if (!ev.ctrlKey && !ev.metaKey) return;
            // Leave text-entry undo alone: this shortcut is for photo fills, and
            // stealing Ctrl+Z from a focused text field would be a data-loss bug.
            const t = ev.target;
            const tag = t && t.tagName;
            if (t && (t.isContentEditable || tag === 'TEXTAREA' ||
                (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'button'))) return;
            ev.preventDefault();
            if (ev.shiftKey) self.redoPhotoMatteUI();
            else self.undoPhotoMatteUI();
        });

        this.updatePhotoMatteControls();
    }
};

// ---------------------------------------------------------------- pure helpers

/* Fit a whole image into a SIZE x SIZE square, centred, padded with white.

   The model input is square but product photos are not, so the image has to be
   scaled to fit and the remainder padded. Squashing it to fill (drawImage with
   width and height both SIZE) would distort every non-square photo; cropping to
   the centre would throw away part of the subject.

   The subtlety that bit us: canvas drawImage has two forms.

       drawImage(img, dx, dy, dW, dH)                        - 5 args, scale whole image
       drawImage(img, sx, sy, sW, sH, dx, dy, dW, dH)        - 9 args, crop then scale

   Passing the *destination* size into the *source* slots of the 9-arg form
   silently succeeds - it is a valid crop, just the wrong rectangle. The model
   then receives the top-left corner of the photo blown up to fill the frame, and
   its perfectly good matte gets stretched back across the entire image on the
   way out. The cutout looks like the right shape in the wrong place, which is
   exactly the "it cropped correctly then moved it" symptom. Hence the 5-arg form
   here, and letterbox() being a named, tested function rather than four inline
   lines inside inferPhotoMatte. */
function IEM_PhotoMatte_letterbox(sourceCanvas, SIZE) {
    const w = sourceCanvas.width, h = sourceCanvas.height;
    if (!w || !h) throw new Error('Nothing to analyse');

    const tmp = document.createElement('canvas');
    tmp.width = SIZE; tmp.height = SIZE;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });

    const scale = Math.min(SIZE / w, SIZE / h);
    const innerW = Math.max(1, Math.round(w * scale));
    const innerH = Math.max(1, Math.round(h * scale));
    const x0 = Math.floor((SIZE - innerW) / 2);
    const y0 = Math.floor((SIZE - innerH) / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 5-argument form: the WHOLE source, scaled into the centred inner rect.
    ctx.drawImage(sourceCanvas, x0, y0, innerW, innerH);

    return {
        data: ctx.getImageData(0, 0, SIZE, SIZE).data,
        innerW: innerW, innerH: innerH, x0: x0, y0: y0
    };
}

/* Bilinear resample of a float mask. Bilinear rather than nearest so the matte
   edge lands smoothly instead of stair-stepping at working resolution. */
function IEM_PhotoMatte_resizeMask(src, sw, sh, dw, dh) {
    const out = new Uint8ClampedArray(dw * dh);
    if (!src || !sw || !sh || !dw || !dh) return out;
    const xRatio = sw / dw;
    const yRatio = sh / dh;
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
        const y0 = Math.floor(sy);
        const y1 = Math.min(sh - 1, y0 + 1);
        const fy = sy - y0;
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
            const x0 = Math.floor(sx);
            const x1 = Math.min(sw - 1, x0 + 1);
            const fx = sx - x0;
            const a = src[y0 * sw + x0], b = src[y0 * sw + x1];
            const c = src[y1 * sw + x0], d = src[y1 * sw + x1];
            const top = a + (b - a) * fx;
            const bot = c + (d - c) * fx;
            out[y * dw + x] = Math.round((top + (bot - top) * fy) * 255);
        }
    }
    return out;
}

/* Strength is AGGRESSIVENESS of the removal, which is how the word reads:
   low  = conservative, keeps more of the subject, softer edge
   high = cuts deeper, crisper edge, eats further into the subject
   0.5  = the model's own output, untouched.

   Modelled as a bias plus a contrast around 0.5 so 0.5 is an exact identity
   and the slider is symmetric about it. */
function IEM_PhotoMatte_applyStrength(mask, strength) {
    const s = Math.max(0, Math.min(1, typeof strength === 'number' ? strength : 0.5));
    if (Math.abs(s - 0.5) < 0.0005) return mask;
    const bias = (0.5 - s) * 0.7;            // >0 keeps more, <0 cuts more
    const contrast = 1 + Math.abs(s - 0.5) * 2.4;
    for (let i = 0; i < mask.length; i++) {
        const a = mask[i] / 255;
        let v = (a - 0.5) * contrast + 0.5 + bias;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        mask[i] = Math.round(v * 255);
    }
    return mask;
}

/* Pull the source RGB once so repeated fills do not re-read the canvas. */
function IEM_PhotoMatte_sourceRGB(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8ClampedArray(w * h * 3);
    for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
        rgb[i] = d[p]; rgb[i + 1] = d[p + 1]; rgb[i + 2] = d[p + 2];
    }
    return rgb;
}

/* Magic-wand region grow, restricted to pixels that already read as
   background OR match the seed's colour.

   The colour test is the whole safety mechanism: clicking a missed backdrop
   removes only backdrop-coloured pixels, so it cannot eat the subject unless
   the subject is genuinely the same colour as the backdrop - which is inherent
   to this kind of tool and is what the undo log is for.

   Tolerance is derived from the local neighbourhood rather than exposed as a
   control, so the fill stays "smart" with no extra UI to explain. */
function IEM_PhotoMatte_regionGrow(mask, rgb, w, h, seedX, seedY) {
    if (!mask || !rgb || seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return 0;

    const R = 3;                       // sample radius
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = seedY - R; y <= seedY + R; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = seedX - R; x <= seedX + R; x++) {
            if (x < 0 || x >= w) continue;
            const i = y * w + x;
            if (mask[i] === 0) continue;   // already background, ignore for stats
            const p = i * 3;
            sr += rgb[p]; sg += rgb[p + 1]; sb += rgb[p + 2]; n++;
        }
    }

    let sd = 0;
    if (n > 0) {
        sr /= n; sg /= n; sb /= n;
        let vr = 0, vg = 0, vb = 0;
        for (let y = seedY - R; y <= seedY + R; y++) {
            if (y < 0 || y >= h) continue;
            for (let x = seedX - R; x <= seedX + R; x++) {
                if (x < 0 || x >= w) continue;
                const i = y * w + x;
                if (mask[i] === 0) continue;
                const p = i * 3;
                vr += Math.abs(rgb[p] - sr);
                vg += Math.abs(rgb[p + 1] - sg);
                vb += Math.abs(rgb[p + 2] - sb);
            }
        }
        sd = (vr + vg + vb) / (3 * n);
    } else {
        // Every pixel around the seed is already transparent. Returning here
        // would make a second click inside a removed region a permanent no-op,
        // so the user could never extend a removal into adjacent background the
        // same tool had not reached. Fall back to the seed's own colour with the
        // default tolerance instead.
        const p = (seedY * w + seedX) * 3;
        sr = rgb[p]; sg = rgb[p + 1]; sb = rgb[p + 2];
    }
    const tol = Math.max(14, Math.min(70, sd * 2.2 + 14));

    const stack = new Int32Array(w * h);
    let sp = 0;
    const seen = new Uint8Array(w * h);
    const seedIdx = seedY * w + seedX;
    stack[sp++] = seedIdx;
    // Mark seen at PUSH, not on pop. Marking on pop lets the same cell be pushed
    // once per neighbour that reaches it, so the stack can exceed w*h; writes
    // past the end of a TypedArray are silently discarded, so pixels would go
    // missing with no error. Marking at push bounds sp to w*h exactly.
    seen[seedIdx] = 1;
    let removed = 0;

    while (sp > 0) {
        const idx = stack[--sp];
        const wasOpaque = mask[idx] !== 0;
        if (wasOpaque) {
            const p = idx * 3;
            const dist = (Math.abs(rgb[p] - sr) + Math.abs(rgb[p + 1] - sg) + Math.abs(rgb[p + 2] - sb)) / 3;
            if (dist > tol) continue;
        }
        mask[idx] = 0;
        // Count only pixels that were actually opaque. Counting every visited
        // pixel would report a non-zero result for a region that was already
        // transparent, and the caller uses a zero return to decide whether the
        // click changed anything - so re-clicking a removed area would keep
        // appending no-op steps to the undo history.
        if (wasOpaque) removed++;
        const x = idx % w, y = (idx - x) / w;
        if (x > 0     && !seen[idx - 1]) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
        if (x < w - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
        if (y > 0     && !seen[idx - w]) { seen[idx - w] = 1; stack[sp++] = idx - w; }
        if (y < h - 1 && !seen[idx + w]) { seen[idx + w] = 1; stack[sp++] = idx + w; }
    }
    return removed;
}

// Attached to IEM_Module so the photo methods below can call these, and so the
// data-cmd dispatcher can reach them by name. IEM_Module is a top-level const in
// iem-module.js, which this file is loaded after.
if (typeof IEM_Module !== 'undefined') {
    Object.assign(IEM_Module, IEM_PhotoMatteMethods);
}

// Expose the pure helpers for the unit verifier.
if (typeof window !== 'undefined') {
    window.IEM_PhotoMatte_test = {
        letterbox: IEM_PhotoMatte_letterbox,
        resizeMask: IEM_PhotoMatte_resizeMask,
        applyStrength: IEM_PhotoMatte_applyStrength,
        regionGrow: IEM_PhotoMatte_regionGrow,
        sourceRGB: IEM_PhotoMatte_sourceRGB
    };
}

// Attach the photo-bar listeners once the DOM can be queried. The bundle is a
// plain concatenation, so this file may be evaluated before or after parsing has
// finished depending on where the <script> sits; readyState covers both.
(function() {
    function boot() {
        if (typeof IEM_Module === 'undefined') return;
        if (typeof IEM_Module.wirePhotoMatteUI !== 'function') return;
        IEM_Module.wirePhotoMatteUI();
    }
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();