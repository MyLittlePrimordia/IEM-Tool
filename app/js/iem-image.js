// IEM review photo handling: upload, zoom/pan, white-background removal hooks and preview.
// Split out of iem-module.js; merged into IEM_Module via Object.assign there.
// Note: iem-photo-matte.js still loads AFTER iem-module.js and overrides preProcessImage /
// toggleBgRemoval / processWhiteBgRemoval on IEM_Module.
const IEM_ImageMethods = {
        imgScale: 1.0,

        imgOffsetX: 0,

        imgOffsetY: 0,

        removeWhiteBg: false,

        rawImageObj: null,

        processedCanvas: null,

        // Background-removal state. Owned by iem-photo-matte.js, declared here
        // so the shape is visible from the object literal:
        //   _matteSourceCanvas - the downscaled ORIGINAL, before any matte. The
        //     model runs on this and every re-composite starts from it, so the
        //     matte can be rebuilt any number of times without re-inferring.
        //   _matteBaseMask     - u2netp alpha at working resolution, 0..255.
        //   _matteFills        - ordered fill seeds (the undo/redo log).
        //   _matteRedoStack    - seeds popped by undo.
        //   _matteStrength     - 0..1 aggressiveness, 0.5 = model output as-is.
        //   _matteBusy         - an inference is in flight.
        _matteSourceCanvas: null,

        _matteBaseMask: null,

        _matteFills: [],

        _matteRedoStack: [],

        _matteStrength: 0.5,

        _matteBusy: false,

        imageDrawPending: false,

        // Serialize an image source (blob: URL string or Blob) to a bounded
        // dataURL for JSON export. blob: object URLs are meaningless outside
        // this session, and raw Blobs JSON.stringify to {} — backups need the
        // bytes embedded. Returns null for absent/invalid images.
        _imageToDataURL: function(sourceUrl, sourceBlob) {
            return new Promise((resolve) => {
                const blob = sourceBlob || null;
                const url = sourceUrl || (blob ? URL.createObjectURL(blob) : null);
                if (!url) { resolve(null); return; }
                const revoke = sourceUrl ? null : url; // only revoke URLs we created
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height;
                        const maxDim = 400;
                        if (w > maxDim || h > maxDim) {
                            if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                            else { w = Math.round((w * maxDim) / h); h = maxDim; }
                        }
                        canvas.width = Math.max(1, w);
                        canvas.height = Math.max(1, h);
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                        if (revoke) { try { URL.revokeObjectURL(revoke); } catch (_) {} }
                        resolve(dataUrl);
                    } catch (e) {
                        if (revoke) { try { URL.revokeObjectURL(revoke); } catch (_) {} }
                        resolve(null);
                    }
                };
                img.onerror = () => {
                    if (revoke) { try { URL.revokeObjectURL(revoke); } catch (_) {} }
                    resolve(null);
                };
                img.src = url;
            });
        },

        handleImageUpload: function(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            this.rawImageObj = new Image();
            this.rawImageObj.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let w = this.rawImageObj.width;
                let h = this.rawImageObj.height;
                const maxDim = 400;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                    else { w = Math.round((w * maxDim) / h); h = maxDim; }
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(this.rawImageObj, 0, 0, w, h);

                canvas.toBlob((blob) => {
                    // toBlob may pass null on encode failure — fall back to a
                    // dataURL-derived Blob so the upload never silently dies.
                    if (!blob) {
                        try {
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                            const bin = atob(dataUrl.split(',')[1]);
                            const bytes = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                            blob = new Blob([bytes], { type: 'image/jpeg' });
                        } catch (e) {
                            showToast("Image processing failed — try another file.", "⚠️");
                            return;
                        }
                    }
                    if (this.currentImage && this.currentImage.startsWith('blob:')) {
                        URL.revokeObjectURL(this.currentImage);
                    }
                    this.currentImageBlob = blob;
                    this.currentImage = URL.createObjectURL(blob);

                    const compressedImg = new Image();
                    compressedImg.onload = () => {
                        this.rawImageObj = compressedImg;
                        this.imgScale = 1.0;
                        this.imgOffsetX = 0;
                        this.imgOffsetY = 0;
                        this.processedCanvas = null;

                        const slider = document.getElementById('image-zoom-slider');
                        if (slider) slider.value = 1.0;

                        document.getElementById('image-preview-canvas').classList.remove('hidden');
                        document.getElementById('image-controls-bar').classList.remove('hidden');
                        document.getElementById('image-clear-btn').classList.remove('hidden');
                        document.getElementById('upload-placeholder').classList.add('hidden');

                        const checkbox = document.getElementById('image-transparency-chk');
                        if (checkbox && checkbox.checked) {
                            this.preProcessImage();
                        } else {
                            this.renderImagePreview();
                        }
                    };
                    compressedImg.src = this.currentImage;
                }, 'image/jpeg', 0.75);
            };
            this.rawImageObj.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    },

        clearImage: function(e) {
        if (e) e.stopPropagation();
        if (this.currentImage && this.currentImage.startsWith('blob:')) {
            URL.revokeObjectURL(this.currentImage);
        }
        this.currentImage = null;
        this.currentImageBlob = null;
        this.rawImageObj = null;
        this.processedCanvas = null;
        // Drop the matte with the photo. The u2netp SESSION is deliberately kept
        // warm - it costs a few tens of MB of WASM heap to rebuild, and the next
        // photo should not have to pay the load again.
        this._matteSourceCanvas = null;
        this._matteBaseMask = null;
        this._matteFills = [];
        this._matteRedoStack = [];
        // Invalidate the packed-RGB cache with the canvas it belongs to.
        this._matteRGB = null;
        this._matteRGBSource = null;
        if (typeof this.updatePhotoMatteControls === 'function') this.updatePhotoMatteControls();
        const uploadInput = document.getElementById('image-upload');
        if (uploadInput) uploadInput.value = '';

        const canvas = document.getElementById('image-preview-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.classList.add('hidden');
        }

        document.getElementById('image-controls-bar').classList.add('hidden');
        document.getElementById('image-clear-btn').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
        this.updateConfidence();
    },

        // Restore an image saved in a library profile or imported JSON. The
        // stored value may be a data URL / path string OR a raw Blob (IndexedDB
        // preserves Blobs; saveToLibrary stores currentImageBlob). Assigning a
        // Blob to img.src coerces to "[object Blob]" and onload never fires, so
        // Blob values get an object URL. Tracked for revocation on replace.
        _restoreStoredImage: function(value) {
            if (!value) { this.clearImage(); return; }
            // Replace any stale uploaded-photo Blob with the incoming one so
            // saveToLibrary (which prefers currentImageBlob) stores the photo
            // actually on screen — the old upload's Blob used to survive here
            // and get saved under the newly-loaded profile's name. For
            // string images (dataURLs) the blob slot must be null: otherwise
            // the stale Blob would shadow the correct string on the next save.
            if (this.currentImage && this.currentImage.startsWith('blob:')) {
                try { URL.revokeObjectURL(this.currentImage); } catch (_) {}
            }
            const isBlob = (typeof Blob !== 'undefined') && (value instanceof Blob);
            this.currentImageBlob = isBlob ? value : null;
            this.currentImage = isBlob ? URL.createObjectURL(value) : value;
            this.rawImageObj = new Image();
            this.rawImageObj.onload = () => {
                document.getElementById('image-preview-canvas').classList.remove('hidden');
                document.getElementById('image-controls-bar').classList.remove('hidden');
                document.getElementById('image-clear-btn').classList.remove('hidden');
                document.getElementById('upload-placeholder').classList.add('hidden');
                this.renderImagePreview();
            };
            this.rawImageObj.onerror = () => {
                console.warn("[IEM] Stored image failed to load — clearing preview.");
                this.clearImage();
            };
            this.rawImageObj.src = this.currentImage;
        },

        initImageControls: function() {
            const wrapper = document.getElementById('image-preview-container');
            if (!wrapper) return;

            let isDragging = false;
            let startX = 0;
            let startY = 0;

            const handleDown = (e) => {
                if (!this.rawImageObj) return;
                isDragging = true;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                startX = clientX - this.imgOffsetX;
                startY = clientY - this.imgOffsetY;
                wrapper.style.cursor = 'grabbing';
                e.preventDefault();
            };

            const handleMove = (e) => {
                if (!isDragging) return;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                this.imgOffsetX = clientX - startX;
                this.imgOffsetY = clientY - startY;
                this.renderImagePreview();
            };

            const handleUp = () => {
                isDragging = false;
                wrapper.style.cursor = 'grab';
            };

            wrapper.addEventListener('mousedown', handleDown);
            wrapper.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);

            wrapper.addEventListener('touchstart', handleDown, { passive: false });
            wrapper.addEventListener('touchmove', handleMove, { passive: false });
            window.addEventListener('touchend', handleUp);

            wrapper.addEventListener('wheel', (e) => {
                if (!this.rawImageObj) return;
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.08 : 0.92;
                this.imgScale = Math.max(0.2, Math.min(8.0, this.imgScale * factor));
                const slider = document.getElementById('image-zoom-slider');
                if (slider) slider.value = this.imgScale;
                this.renderImagePreview();
            }, { passive: false });
        },

        handleZoomSlider: function(val) {
            // ONE slider serves two meanings. While background removal is on it
            // is edge STRENGTH, not zoom. Pan and zoom stay reachable on
            // drag + wheel, so repurposing the slider costs nothing - and a
            // second slider would mean two ranges fighting over one row.
            if (this.removeWhiteBg) {
                this.setPhotoMatteStrength(parseFloat(val) / 100);
                return;
            }
            this.imgScale = parseFloat(val);
            this.renderImagePreview();
        },

        recenterImage: function() {
            this.imgScale = 1.0;
            this.imgOffsetX = 0;
            this.imgOffsetY = 0;
            const slider = document.getElementById('image-zoom-slider');
            if (slider) slider.value = 1.0;
            this.renderImagePreview();
        },

        preProcessImage: function() {
            if (!this.rawImageObj) return;

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');

            const maxDimension = 800;
            let w = this.rawImageObj.width;
            let h = this.rawImageObj.height;
            if (w > maxDimension || h > maxDimension) {
                if (w > h) {
                    h = Math.round((h * maxDimension) / w);
                    w = maxDimension;
                } else {
                    w = Math.round((w * maxDimension) / h);
                    h = maxDimension;
                }
            }

            tempCanvas.width = w;
            tempCanvas.height = h;

            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(this.rawImageObj, 0, 0, w, h);

            // Keep the un-matted original. Everything downstream - the model, the
            // strength slider, every fill, undo and redo - is derived from this
            // one canvas, so nothing has to re-run inference to change the matte.
            this._matteSourceCanvas = tempCanvas;

            if (this.removeWhiteBg) {
                // Inference is async. Paint the original straight away so the
                // photo appears immediately while the model works, then swap in
                // the cutout when it lands.
                this.processedCanvas = tempCanvas;
                this._matteBaseMask = null;
                this._matteFills = [];
                this._matteRedoStack = [];
                this.renderImagePreview();
                this.applyPhotoMatte();
            } else {
                this._matteBaseMask = null;
                this._matteFills = [];
                this._matteRedoStack = [];
                this.processedCanvas = tempCanvas;
                this.renderImagePreview();
            }
        },

        toggleBgRemoval: function(checked) {
            this.removeWhiteBg = checked;
            if (typeof this.updatePhotoMatteControls === 'function') this.updatePhotoMatteControls();

            if (checked) {
                if (!this._matteSourceCanvas) this.preProcessImage();
                else this.applyPhotoMatte();
            } else {
                // Off: fall back to the untouched original. The model session is
                // kept warm so turning it back on is instant.
                this._matteBaseMask = null;
                this._matteFills = [];
                this._matteRedoStack = [];
                this.processedCanvas = this._matteSourceCanvas || this.processedCanvas;
                this.renderImagePreview();
            }
        },

        /* True while u2netp is loading or running, so the UI can show progress
           and refuse to queue overlapping runs. */
        isPhotoMatteBusy: function() {
            return !!this._matteBusy;
        },

        /* REMOVED: processWhiteBgRemoval (the old white-background flood fill).
           It decided "background" from pixel brightness, so it could not tell a
           white backdrop from a white highlight on the product, and its
           brightness->alpha ramp ran across the whole image rather than just the
           cut edge - which punched pale detail out of the subject and composited
           it darker over the dark export card. Background removal now lives in
           app/js/iem-photo-matte.js and runs u2netp through ONNX Runtime Web,
           which writes ALPHA ONLY and never touches RGB. */
        renderImagePreview: function() {
            if (this.imageDrawPending) return;
            this.imageDrawPending = true;
            requestAnimationFrame(() => {
                this.imageDrawPending = false;
                this.renderImagePreviewInternal();
            });
        },

        renderImagePreviewInternal: function() {
            const canvas = document.getElementById('image-preview-canvas');
            if (!canvas || !this.rawImageObj) return;
            const ctx = canvas.getContext('2d');

            const rect = canvas.parentNode.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Transparency backdrop.
            //
            // Removing the backdrop from a DARK product leaves dark pixels on a
            // dark well, so only the highlights survive visually - the cutout
            // reads as "the remover ate my photo" when the matte was in fact
            // fine. A neutral checkerboard underneath fixes that for any
            // subject: it shows through wherever alpha is 0 and is covered
            // wherever alpha is not.
            //
            // Drawn into the PREVIEW canvas only. The export path uses
            // processedCanvas, so this can never reach a saved file - the
            // checkerboard is a viewing aid, not part of the image.
            if (this.removeWhiteBg && this.processedCanvas) {
                const CELL = 16;
                let tile = this._matteCheckerTile;
                if (!tile) {
                    tile = document.createElement('canvas');
                    tile.width = CELL; tile.height = CELL;
                    const tctx = tile.getContext('2d');
                    // Two mid greys rather than the usual light/white: light
                    // squares hide a white product, dark squares hide a black
                    // one, and mid grey stays legible against both.
                    tctx.fillStyle = '#8a8a8a';
                    tctx.fillRect(0, 0, CELL, CELL);
                    tctx.fillStyle = '#a8a8a8';
                    tctx.fillRect(0, 0, CELL / 2, CELL / 2);
                    tctx.fillRect(CELL / 2, CELL / 2, CELL / 2, CELL / 2);
                    this._matteCheckerTile = tile;
                }
                const pattern = ctx.createPattern(tile, 'repeat');
                ctx.fillStyle = pattern || '#8a8a8a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const img = (this.removeWhiteBg && this.processedCanvas) ? this.processedCanvas : this.rawImageObj;
            const iw = img.width;
            const ih = img.height;
            const cw = canvas.width;
            const ch = canvas.height;

            const rImg = iw / ih;
            const rCvs = cw / ch;
            let drawW = cw;
            let drawH = ch;
            if (rImg > rCvs) {
                drawH = cw / rImg;
            } else {
                drawW = ch * rImg;
            }

            ctx.save();
            ctx.translate(cw / 2 + this.imgOffsetX, ch / 2 + this.imgOffsetY);
            ctx.scale(this.imgScale, this.imgScale);
            ctx.translate(-drawW / 2, -drawH / 2);
            ctx.drawImage(img, 0, 0, drawW, drawH);
            ctx.restore();

            // Record the geometry that produced this frame. A double-click on the
            // photo has to be inverted back through exactly this transform to
            // find which pixel was hit, and recomputing the contain-fit here
            // would be a second copy of these four lines free to drift out of
            // step with them - which would put fills in the wrong place after a
            // resize rather than fail loudly.
            this._photoDrawRect = {
                cw: cw, ch: ch,
                drawW: drawW, drawH: drawH,
                scale: this.imgScale,
                offX: this.imgOffsetX, offY: this.imgOffsetY,
                canvas: canvas
            };
        },
};
