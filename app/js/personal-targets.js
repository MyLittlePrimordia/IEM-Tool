// My Sound: personal targets, a listening preference trainer, and the guided
// fix-my-sound coach live behind one entry point on the EQ target row.
//
// A personal target is built from the same ingredients the app already has:
//   * a built-in baseline (Harman / Moondrop VDSF / Diffuse / ...),
//   * the average deviation of the user's Find taste favourites from that
//     baseline (a preference, not a correction),
//   * the hearing-calibration offsets Test Lab measured,
//   * the user's own ear-canal resonance frequency,
//   * the bass/treble tilt the A/B trainer learned.
// Nothing here invents measurements: every ingredient is either a curve the
// app already ships, a curve the user favourited, or a value the user measured
// in Test Lab. Missing ingredients are simply left out and disclosed in the
// preview summary.
const PersonalTargets = {
    TARGET_KEY: 'iem_personal_targets_v1',
    TRAIN_KEY: 'iem_trained_prefs_v1',
    _modal: null,
    _tab: 'targets',
    _trainer: null,
    _preview: null,

    install: function () {
        this.refreshTargetCatalog();
        // Keep the target stepper in sync when a different saved profile is
        // created in another window/tab of the same app.
        window.addEventListener('storage', (e) => {
            if (e && e.key === this.TARGET_KEY) this.refreshTargetCatalog();
        });
    },

    _readJSON: function (key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : fallback;
        } catch (e) { return fallback; }
    },

    _writeJSON: function (key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) {
            showToast('Could not save — browser storage is full.', '⚠️');
            return false;
        }
    },

    _loadSaved: function () {
        const raw = this._readJSON(this.TARGET_KEY, []);
        return (Array.isArray(raw) ? raw : []).filter(t =>
            t && typeof t.id === 'string' && t.id.indexOf('personal_') === 0 &&
            Array.isArray(t.data) && t.data.length > 1
        );
    },

    _saveSaved: function (list) {
        // Keep newest first and cap the list: every target is a full curve.
        const kept = list.slice(0, 24).map(t => ({
            id: t.id,
            name: String(t.name || 'My Target').slice(0, 60),
            data: t.data,
            createdAt: t.createdAt || Date.now(),
            summary: t.summary || ''
        }));
        return this._writeJSON(this.TARGET_KEY, kept);
    },

    // Rebuild the TARGETS map and the stepper's option list from the saved
    // records. Called at boot and after every create/delete.
    refreshTargetCatalog: function () {
        if (typeof PEQDB_Module === 'undefined' || !PEQDB_Module.TARGETS) return;
        const saved = this._loadSaved();
        Object.keys(PEQDB_Module.TARGETS).forEach(key => {
            if (key.indexOf('personal_') === 0) delete PEQDB_Module.TARGETS[key];
        });
        saved.forEach(t => {
            PEQDB_Module.TARGETS[t.id] = { id: t.id, name: t.name, data: t.data, personal: true };
        });
        const baseOptions = (PEQDB_Module.targetOptions || []).filter(o => o.val === '' || o.val.indexOf('personal_') !== 0);
        const personalOptions = saved.map(t => ({ val: t.id, label: '⭐ ' + t.name }));
        PEQDB_Module.targetOptions = baseOptions.concat(personalOptions);
        // The selected target's index drives the ◀/▶ stepper; rebuild it so a
        // delete does not leave the stepper pointing at a stale row.
        const active = PEQDB_Module.targetMode || '';
        const idx = PEQDB_Module.targetOptions.findIndex(o => o.val === active);
        PEQDB_Module.currentTargetIdx = idx >= 0 ? idx : 0;
    },

    _builtInTargets: function () {
        const out = [];
        const opts = (PEQDB_Module && PEQDB_Module.targetOptions) || [];
        opts.forEach(o => {
            if (!o.val || o.val === 'sculptor' || o.val.indexOf('personal_') === 0) return;
            if (PEQDB_Module.TARGETS[o.val]) out.push({ val: o.val, label: (o.label || o.val).replace(/^[^\w]+/, '').trim() });
        });
        return out;
    },

    _grid: function () {
        return CurveUtils.generateLogGrid(220, 20, 20000);
    },

    _interp: function (data, grid) {
        if (!Array.isArray(data) || data.length < 2) return null;
        return CurveUtils.cubicSplineInterpolate(data, grid);
    },

    _clamp: function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

    _lowShelfCurve: function (grid, gain, cornerHz) {
        return Array.from(grid, f => {
            const t = Math.log10(f / cornerHz) / 0.28;
            return gain * 0.5 * (1 - Math.tanh(t));
        });
    },

    _highShelfCurve: function (grid, gain, cornerHz) {
        return Array.from(grid, f => {
            const t = Math.log10(f / cornerHz) / 0.28;
            return gain * 0.5 * (1 + Math.tanh(t));
        });
    },

    _peakingCurve: function (grid, gain, centerHz, widthLog) {
        const sigma = widthLog || 0.22;
        return Array.from(grid, f => {
            const d = Math.log10(f / centerHz) / sigma;
            return gain * Math.exp(-0.5 * d * d);
        });
    },

    _trainedPrefs: function () {
        const p = this._readJSON(this.TRAIN_KEY, null);
        if (!p || typeof p !== 'object') return null;
        const dims = ['bass', 'treble', 'warmth', 'mid', 'air'];
        const out = { rounds: p.rounds || 0, values: {} };
        let any = false;
        dims.forEach(k => {
            const v = Number(p.values && p.values[k]);
            out.values[k] = Number.isFinite(v) ? this._clamp(v, -3, 3) : 0;
            if (Math.abs(out.values[k]) >= 0.1) any = true;
        });
        return (any && out.rounds >= 4) ? out : null;
    },

    // Average how far the user's favourite signatures sit from the baseline
    // (after a broadband-level normalisation), so a bass-heavy favourite pulls
    // the target's bass up rather than shifting the whole curve.
    _tasteDelta: async function (grid, baseInterp) {
        if (typeof FindEngine === 'undefined' || !Array.isArray(FindEngine.tasteFavorites) || !FindEngine.tasteFavorites.length) {
            return { delta: null, count: 0, names: [] };
        }
        const dataset = (PEQDB_Module.STATE && PEQDB_Module.STATE.dataset) || [];
        const usable = [];
        for (const fav of FindEngine.tasteFavorites) {
            const item = dataset.find(i => i.id === fav.id);
            if (!item) continue;
            if ((!item.data || item.data.length < 2) && typeof CurveIndexer !== 'undefined') {
                try { await CurveIndexer.loadCurve(item, 0); } catch (e) {}
            }
            if (item.data && item.data.length > 1) usable.push({ name: fav.name || item.name, data: item.data });
        }
        if (!usable.length) return { delta: null, count: 0, names: [] };

        const baseAtOne = baseInterp[this._nearestIndex(grid, 1000)];
        const sums = new Float64Array(grid.length);
        usable.forEach(u => {
            const normalized = CurveUtils.normalizeTo75dB(u.data, 1000, 75);
            const interp = this._interp(normalized, grid);
            if (!interp) return;
            for (let i = 0; i < grid.length; i++) {
                // Compare each favourite to the baseline at the same level.
                sums[i] += interp[i] - (baseInterp[i] - baseAtOne + 75);
            }
        });
        const delta = new Float32Array(grid.length);
        for (let i = 0; i < grid.length; i++) {
            delta[i] = this._clamp((sums[i] / usable.length) * 0.55, -6, 6);
        }
        const smoothed = CurveUtils.gaussianSmooth(grid, delta, 0.11);
        return { delta: smoothed, count: usable.length, names: usable.map(u => u.name) };
    },

    _nearestIndex: function (grid, hz) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < grid.length; i++) {
            const d = Math.abs(Math.log(grid[i] / hz));
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    },

    _hearingDelta: function (grid) {
        if (typeof EQ_Module === 'undefined' || !EQ_Module.hearingCalEnabled) return null;
        const offsets = Array.isArray(EQ_Module.hearingOffsets) ? EQ_Module.hearingOffsets : null;
        if (!offsets || !offsets.some(v => Number(v) > 0)) return null;
        const anchors = [250, 500, 1000, 2000, 4000, 8000, 12000, 16000];
        const vals = offsets.map(v => this._clamp(Number(v) || 0, 0, 6));
        if (!vals.some(v => v > 0)) return null;
        const out = new Float32Array(grid.length);
        for (let i = 0; i < grid.length; i++) {
            const f = grid[i];
            if (f <= anchors[0]) { out[i] = vals[0] * 0.6; continue; }
            if (f >= anchors[anchors.length - 1]) { out[i] = vals[vals.length - 1] * 0.6; continue; }
            let k = 0;
            while (k < anchors.length - 2 && anchors[k + 1] < f) k++;
            const t = (Math.log(f) - Math.log(anchors[k])) / (Math.log(anchors[k + 1]) - Math.log(anchors[k]));
            out[i] = (vals[k] + (vals[k + 1] - vals[k]) * t) * 0.6;
        }
        return out;
    },

    _resonanceDelta: function (grid) {
        const hz = Number(PEQDB_Module.resonanceHz);
        if (!Number.isFinite(hz) || hz < 2000 || hz > 16000) return null;
        // A canal resonance peak makes that band louder for this listener; a
        // gentle dip in the target keeps the perceived balance closer to flat.
        return this._peakingCurve(grid, -1.8, hz, 0.13);
    },

    _trainedDelta: function (grid) {
        const p = this._trainedPrefs();
        if (!p) return null;
        const v = p.values;
        const out = new Float32Array(grid.length);
        const bass = this._lowShelfCurve(grid, v.bass, 130);
        const treble = this._highShelfCurve(grid, v.treble, 5500);
        const warmth = this._peakingCurve(grid, v.warmth, 250, 0.25);
        const mid = this._peakingCurve(grid, v.mid, 2600, 0.2);
        const air = this._highShelfCurve(grid, v.air, 11000);
        for (let i = 0; i < grid.length; i++) out[i] = bass[i] + treble[i] + warmth[i] + mid[i] + air[i];
        return out;
    },

    // opts: { baseId, useTaste, useHearing, useResonance, useTrained }
    buildCurve: async function (opts) {
        opts = opts || {};
        const grid = this._grid();
        const baseId = opts.baseId || (PEQDB_Module.targetMode && PEQDB_Module.TARGETS[PEQDB_Module.targetMode] ? PEQDB_Module.targetMode : 'harman');
        const base = PEQDB_Module.TARGETS[baseId] || PEQDB_Module.TARGETS.harman;
        const baseInterp = this._interp(base.data, grid);
        if (!baseInterp) throw new Error('Target baseline has no usable curve data.');
        const out = Float32Array.from(baseInterp);
        const sources = ['Baseline: ' + (base.name || baseId)];

        if (opts.useTaste) {
            const taste = await this._tasteDelta(grid, baseInterp);
            if (taste.delta) {
                for (let i = 0; i < grid.length; i++) out[i] += taste.delta[i];
                sources.push(`${taste.count} taste favourite${taste.count === 1 ? '' : 's'}`);
            } else {
                sources.push('no loaded taste favourites');
            }
        }
        if (opts.useHearing) {
            const h = this._hearingDelta(grid);
            if (h) {
                for (let i = 0; i < grid.length; i++) out[i] += h[i];
                sources.push('hearing calibration');
            } else {
                sources.push('no hearing calibration');
            }
        }
        if (opts.useResonance) {
            const r = this._resonanceDelta(grid);
            if (r) {
                for (let i = 0; i < grid.length; i++) out[i] += r[i];
                sources.push(`canal resonance ${Math.round(Number(PEQDB_Module.resonanceHz)).toLocaleString()} Hz`);
            } else {
                sources.push('no locked resonance peak');
            }
        }
        if (opts.useTrained) {
            const t = this._trainedDelta(grid);
            if (t) {
                for (let i = 0; i < grid.length; i++) out[i] += t[i];
                sources.push('trainer preference');
            } else {
                sources.push('no trainer result');
            }
        }

        // Keep the target level at the usual 1 kHz anchor so it drops into the
        // existing graph/AutoEQ flow exactly like a built-in target.
        const one = this._nearestIndex(grid, 1000);
        const offset = 75 - out[one];
        const data = [];
        for (let i = 0; i < grid.length; i++) {
            data.push([Math.round(grid[i] * 100) / 100, Math.round((out[i] + offset) * 100) / 100]);
        }
        return { data, summary: sources.join(' · '), grid, curve: out, baseName: base.name || baseId };
    },

    saveTarget: async function (name, opts) {
        const clean = String(name || '').trim().slice(0, 60);
        if (!clean) { showToast('Give this target a name first.', '⚠️'); return null; }
        const built = await this.buildCurve(opts);
        const id = 'personal_' + Date.now().toString(36);
        const rec = { id, name: clean, data: built.data, createdAt: Date.now(), summary: built.summary };
        const list = this._loadSaved();
        list.unshift(rec);
        if (!this._saveSaved(list)) return null;
        this.refreshTargetCatalog();
        if (typeof PEQDB_Module.setTarget === 'function') PEQDB_Module.setTarget(id);
        showToast(`Saved "${clean}" as a target and applied it.`, '⭐');
        return rec;
    },

    deleteTarget: async function (id) {
        const rec = this._loadSaved().find(t => t.id === id);
        if (!rec) return;
        const ok = await UIKit.confirm({
            title: 'Delete this target?',
            message: `"${rec.name}" will be removed. A copy already exported to an EQ preset is not affected.`,
            confirmLabel: 'Delete', danger: true
        });
        if (!ok) return;
        if (PEQDB_Module.targetMode === id) PEQDB_Module.setTarget('');
        this._saveSaved(this._loadSaved().filter(t => t.id !== id));
        this.refreshTargetCatalog();
        this.renderTargetsTab();
        showToast('Target deleted.', '🗑️');
    },

    // ---------------------------------------------------------------- UI ----
    ensureModal: function () {
        if (this._modal) return this._modal;
        const wrap = document.createElement('div');
        wrap.id = 'my-sound-modal';
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden items-center justify-center p-4';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-labelledby', 'my-sound-title');
        wrap.innerHTML = `
            <div class="bg-[var(--bg-card)] border border-[var(--line)] w-full max-w-3xl flex flex-col overflow-hidden" style="border-radius: var(--r-xl); box-shadow: var(--sh-3); max-height: calc(100vh - 32px);">
                <div class="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--line)] flex-shrink-0">
                    <div class="min-w-0">
                        <div id="my-sound-title" class="type-md font-semibold flex items-center gap-2" style="color: var(--text-hi);">🎧 My Sound</div>
                        <div class="type-xs mt-0.5" style="color: var(--text-mid);">Targets built from your ears, not a generic average.</div>
                    </div>
                    <button id="my-sound-x" type="button" class="app-caption-btn" style="width:28px;height:28px;" aria-label="Close">✕</button>
                </div>
                <div class="flex gap-1.5 px-5 pt-3 flex-shrink-0" role="tablist" aria-label="My Sound sections">
                    <button type="button" class="my-sound-tab" data-tab="targets" role="tab">⭐ Targets</button>
                    <button type="button" class="my-sound-tab" data-tab="trainer" role="tab">🧪 Trainer</button>
                    <button type="button" class="my-sound-tab" data-tab="fix" role="tab">🩺 Fix my sound</button>
                </div>
                <div id="my-sound-body" class="p-5 overflow-y-auto" style="flex:1 1 auto; min-height:220px;"></div>
                <div id="my-sound-foot" class="px-5 py-2.5 border-t border-[var(--line)] type-micro flex items-center justify-between gap-3 flex-shrink-0" style="color: var(--text-lo);">
                    <span>Every ingredient is optional. Nothing is invented.</span>
                    <button id="my-sound-done" type="button" class="btn-clear cursor-pointer" style="height:30px;padding:0 14px;border-radius:var(--r-md);">Done</button>
                </div>
            </div>`;
        document.body.appendChild(wrap);
        const close = () => this.close();
        wrap.querySelector('#my-sound-x').onclick = close;
        wrap.querySelector('#my-sound-done').onclick = close;
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        wrap.querySelectorAll('.my-sound-tab').forEach(btn => {
            btn.addEventListener('click', () => this.showTab(btn.getAttribute('data-tab')));
        });
        this._modal = wrap;
        return wrap;
    },

    open: function (tab) {
        this.ensureModal();
        this._modal.classList.remove('hidden');
        this._modal.classList.add('flex');
        this.showTab(tab || this._tab || 'targets');
        this._lastFocus = document.activeElement;
    },

    close: function () {
        if (this._trainer) this.stopTrainer();
        const wrap = this._modal;
        if (!wrap) return;
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
        const back = this._lastFocus;
        this._lastFocus = null;
        if (back && back.isConnected) { try { back.focus(); } catch (e) {} }
    },

    showTab: function (tab) {
        this._tab = tab;
        this._modal.querySelectorAll('.my-sound-tab').forEach(btn => {
            const on = btn.getAttribute('data-tab') === tab;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const body = this._modal.querySelector('#my-sound-body');
        body.scrollTop = 0;
        if (tab === 'trainer') this.renderTrainerTab();
        else if (tab === 'fix') this.renderFixTab();
        else this.renderTargetsTab();
    },

    _summaryLine: function (tag, text, on) {
        return `<span class="pt-chip ${on ? 'is-on' : ''}">${tag} ${esc(text)}</span>`;
    },

    renderTargetsTab: function () {
        const body = this._modal.querySelector('#my-sound-body');
        const bases = this._builtInTargets();
        const saved = this._loadSaved();
        const tasteCount = (typeof FindEngine !== 'undefined' && Array.isArray(FindEngine.tasteFavorites)) ? FindEngine.tasteFavorites.length : 0;
        const hearingOn = typeof EQ_Module !== 'undefined' && EQ_Module.hearingCalEnabled && Array.isArray(EQ_Module.hearingOffsets) && EQ_Module.hearingOffsets.some(v => Number(v) > 0);
        const resoHz = Number(PEQDB_Module.resonanceHz);
        const resoOn = Number.isFinite(resoHz) && resoHz >= 2000 && resoHz <= 16000;
        const trained = this._trainedPrefs();
        const currentBase = (PEQDB_Module.targetMode && PEQDB_Module.TARGETS[PEQDB_Module.targetMode] && !PEQDB_Module.TARGETS[PEQDB_Module.targetMode].personal)
            ? PEQDB_Module.targetMode : 'harman';

        body.innerHTML = `
            <div class="grid gap-4" style="grid-template-columns: minmax(0,1fr) minmax(0,1.05fr);">
                <div>
                    <label class="type-micro font-black uppercase tracking-wider" style="color: var(--text-lo);">Target name</label>
                    <input id="pt-name" type="text" maxlength="60" placeholder="e.g. My warm Harman" class="w-full mt-1 mb-3" style="height:34px;padding:0 10px;background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-sm);color:var(--text-hi);font-size:var(--t-sm);">
                    <label class="type-micro font-black uppercase tracking-wider" style="color: var(--text-lo);">Baseline</label>
                    <select id="pt-base" class="w-full mt-1 mb-3" style="height:34px;padding:0 8px;background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-sm);color:var(--text-hi);font-size:var(--t-sm);">
                        ${bases.map(b => `<option value="${esc(b.val)}" ${b.val === currentBase ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}
                    </select>
                    <div class="type-micro font-black uppercase tracking-wider mb-1.5" style="color: var(--text-lo);">Blend in</div>
                    <label class="pt-opt ${tasteCount ? '' : 'is-disabled'}"><input id="pt-use-taste" type="checkbox" ${tasteCount ? '' : 'disabled'} ${tasteCount ? 'checked' : ''}> <span>❤️ Taste favourites</span><em>${tasteCount ? tasteCount + ' loaded' : 'add favourites in Find'}</em></label>
                    <label class="pt-opt ${hearingOn ? '' : 'is-disabled'}"><input id="pt-use-hearing" type="checkbox" ${hearingOn ? '' : 'disabled'} ${hearingOn ? 'checked' : ''}> <span>👂 Hearing calibration</span><em>${hearingOn ? 'measured' : 'run the hearing test'}</em></label>
                    <label class="pt-opt ${resoOn ? '' : 'is-disabled'}"><input id="pt-use-reso" type="checkbox" ${resoOn ? '' : 'disabled'} ${resoOn ? 'checked' : ''}> <span>🎯 Canal resonance</span><em>${resoOn ? Math.round(resoHz).toLocaleString() + ' Hz' : 'lock a peak in Test Lab'}</em></label>
                    <label class="pt-opt ${trained ? '' : 'is-disabled'}"><input id="pt-use-train" type="checkbox" ${trained ? '' : 'disabled'} ${trained ? 'checked' : ''}> <span>🧪 Trainer tilt</span><em>${trained ? trained.rounds + ' rounds' : 'run the trainer'}</em></label>
                    <div class="flex gap-2 mt-3">
                        <button id="pt-preview" type="button" class="btn-clear cursor-pointer" style="height:32px;padding:0 12px;border-radius:var(--r-sm);">Preview</button>
                        <button id="pt-save" type="button" class="cta-primary no-tactile cursor-pointer" style="height:32px;padding:0 14px;border-radius:var(--r-sm);">Save &amp; apply</button>
                    </div>
                </div>
                <div>
                    <div class="type-micro font-black uppercase tracking-wider mb-1.5" style="color: var(--text-lo);">Preview</div>
                    <div class="pt-preview-box"><canvas id="pt-canvas" width="420" height="150"></canvas></div>
                    <div id="pt-summary" class="type-xs mt-2 leading-relaxed" style="color: var(--text-mid);">Pick a baseline and press Preview.</div>
                    <div class="type-micro font-black uppercase tracking-wider mt-4 mb-1.5" style="color: var(--text-lo);">Saved targets</div>
                    <div id="pt-list" class="grid gap-1.5">${saved.length ? '' : '<div class="type-xs" style="color:var(--text-lo);">No personal targets yet.</div>'}</div>
                </div>
            </div>`;

        body.querySelectorAll('#pt-use-taste, #pt-use-hearing, #pt-use-reso, #pt-use-train, #pt-base').forEach(el => {
            el.addEventListener('change', () => this.previewTargets());
        });
        body.querySelector('#pt-preview').addEventListener('click', () => this.previewTargets());
        body.querySelector('#pt-save').addEventListener('click', () => this.saveFromForm());
        this._renderSavedTargetList(body, saved);
        this.previewTargets();
    },

    _renderSavedTargetList: function (body, saved) {
        const list = body.querySelector('#pt-list');
        if (!list) return;
        list.innerHTML = '';
        saved.forEach(t => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2';
            row.style.cssText = 'padding:6px 8px;background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-sm);';
            row.innerHTML = `<span class="type-xs font-semibold truncate flex-1" style="color:var(--text-hi);" title="${esc(t.summary || '')}">⭐ ${esc(t.name)}</span>`;
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'btn-clear cursor-pointer type-micro';
            apply.style.cssText = 'height:26px;padding:0 9px;border-radius:var(--r-xs);';
            apply.textContent = PEQDB_Module.targetMode === t.id ? 'Applied' : 'Apply';
            apply.disabled = PEQDB_Module.targetMode === t.id;
            apply.addEventListener('click', () => {
                PEQDB_Module.setTarget(t.id);
                this.renderTargetsTab();
                showToast('Applied "' + t.name + '" as the target.', '⭐');
            });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'type-micro cursor-pointer';
            del.style.cssText = 'height:26px;padding:0 7px;background:transparent;border:1px solid transparent;color:var(--text-lo);border-radius:var(--r-xs);';
            del.textContent = '✕';
            del.title = 'Delete this target';
            del.addEventListener('click', () => this.deleteTarget(t.id));
            row.appendChild(apply);
            row.appendChild(del);
            list.appendChild(row);
        });
    },

    _formOptions: function () {
        const q = (id) => {
            const el = this._modal.querySelector(id);
            return el ? el.checked : false;
        };
        return {
            baseId: this._modal.querySelector('#pt-base').value || 'harman',
            useTaste: q('#pt-use-taste'),
            useHearing: q('#pt-use-hearing'),
            useResonance: q('#pt-use-reso'),
            useTrained: q('#pt-use-train')
        };
    },

    previewTargets: async function () {
        if (this._previewBusy) return;
        this._previewBusy = true;
        try {
            const opts = this._formOptions();
            const built = await this.buildCurve(opts);
            this._preview = built;
            const canvas = this._modal.querySelector('#pt-canvas');
            if (canvas) this._drawPreview(canvas, built.curve, built.grid);
            const summary = this._modal.querySelector('#pt-summary');
            if (summary) summary.textContent = built.summary;
        } catch (e) {
            console.error('[My Sound] preview failed', e);
            const summary = this._modal.querySelector('#pt-summary');
            if (summary) summary.textContent = 'Could not build a preview: ' + (e && e.message ? e.message : e);
        } finally {
            this._previewBusy = false;
        }
    },

    _drawPreview: function (canvas, curve, grid) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 420, cssH = canvas.clientHeight || 150;
        if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = '#050507';
        ctx.fillRect(0, 0, cssW, cssH);
        const padL = 26, padR = 8, padT = 10, padB = 18;
        const fMin = 20, fMax = 20000;
        const x = (f) => padL + (Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin)) * (cssW - padL - padR);
        const y = (db) => padT + (100 - db) / (100 - 50) * (cssH - padT - padB);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        [50, 60, 70, 80, 90, 100].forEach(db => {
            ctx.beginPath(); ctx.moveTo(padL, y(db)); ctx.lineTo(cssW - padR, y(db)); ctx.stroke();
        });
        [20, 100, 1000, 10000, 20000].forEach(f => {
            ctx.beginPath(); ctx.moveTo(x(f), padT); ctx.lineTo(x(f), cssH - padB); ctx.stroke();
        });
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < grid.length; i++) {
            const px = x(grid[i]), py = y(curve[i]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.fillText('20', 2, cssH - 6);
        ctx.fillText('1k', x(1000) - 5, cssH - 6);
        ctx.fillText('20k', cssW - 22, cssH - 6);
    },

    saveFromForm: async function () {
        const nameEl = this._modal.querySelector('#pt-name');
        const name = nameEl ? nameEl.value : '';
        if (!String(name || '').trim()) { showToast('Give this target a name first.', '⚠️'); return; }
        try {
            await this.saveTarget(name, this._formOptions());
            this.renderTargetsTab();
        } catch (e) {
            showToast('Could not build that target: ' + (e && e.message ? e.message : e), '⚠️');
        }
    },

    // ------------------------------------------------------------ Trainer ----
    renderTrainerTab: function () {
        const body = this._modal.querySelector('#my-sound-body');
        const trained = this._trainedPrefs();
        const t = this._trainer;
        body.innerHTML = `
            <div class="grid gap-4" style="grid-template-columns: minmax(0,1.1fr) minmax(0,0.9fr);">
                <div>
                    <div class="type-sm font-semibold" style="color:var(--text-hi);">Which tilt do you actually prefer?</div>
                    <p class="type-xs mt-1 leading-relaxed" style="color:var(--text-mid);">Eight short A/B comparisons over a synthesized loop. Each pair differs by one band — bass weight, warmth, presence, treble or air. Pick the one that sounds more natural; the trainer turns your wins into a small tilt that can be blended into a personal target.</p>
                    <div id="pt-train-stage" class="mt-3"></div>
                </div>
                <div>
                    <div class="type-micro font-black uppercase tracking-wider mb-1.5" style="color:var(--text-lo);">Learned preference</div>
                    <div id="pt-train-summary" class="type-xs leading-relaxed" style="color:var(--text-mid);">${trained ? this._trainedSummaryText(trained) : 'No result yet — run the trainer.'}</div>
                    <div class="type-micro mt-3" style="color:var(--text-lo);">The loop is generated locally (no files, no uploads). Use headphones; pause your music first.</div>
                </div>
            </div>`;
        if (!t || !t.active) this._renderTrainerIdle();
        else this._renderTrainerRound();
    },

    _trainedSummaryText: function (p) {
        const labels = { bass: 'Bass', warmth: 'Warmth', mid: 'Presence', treble: 'Treble', air: 'Air' };
        const parts = Object.keys(labels).filter(k => Math.abs(p.values[k] || 0) >= 0.1)
            .map(k => `${labels[k]} ${p.values[k] > 0 ? '+' : ''}${p.values[k].toFixed(1)} dB`);
        return (parts.length ? parts.join(' · ') : 'Neutral (no clear tilt)') + ` — ${p.rounds} rounds.`;
    },

    _renderTrainerIdle: function () {
        const stage = this._modal.querySelector('#pt-train-stage');
        if (!stage) return;
        stage.innerHTML = `
            <div class="pt-preview-box flex flex-col items-center justify-center gap-2" style="height:168px;">
                <span style="font-size:32px;">🧪</span>
                <button id="pt-train-start" type="button" class="cta-primary no-tactile cursor-pointer" style="height:34px;padding:0 18px;border-radius:var(--r-sm);">Start 8-round trainer</button>
                <span class="type-micro" style="color:var(--text-lo);">Takes about a minute</span>
            </div>`;
        stage.querySelector('#pt-train-start').addEventListener('click', () => this.startTrainer());
    },

    _trainerDims: ['bass', 'treble', 'warmth', 'mid', 'air', 'bass', 'treble', 'mid'],

    startTrainer: async function () {
        try {
            this._initTrainerAudio();
        } catch (e) {
            showToast('Could not start the trainer audio: ' + (e && e.message ? e.message : e), '⚠️');
            return;
        }
        this._trainer = {
            active: true,
            round: 0,
            total: this._trainerDims.length,
            scores: { bass: 0, treble: 0, warmth: 0, mid: 0, air: 0 },
            counts: { bass: 0, treble: 0, warmth: 0, mid: 0, air: 0 },
            current: null,
            choices: []
        };
        this._nextTrainerRound();
    },

    _nextTrainerRound: function () {
        const t = this._trainer;
        if (!t || !t.active) return;
        if (t.round >= t.total) { this._finishTrainer(); return; }
        const dim = this._trainerDims[t.round];
        const flip = Math.random() < 0.5 ? 1 : -1;
        const amount = 2.2;
        // A is +amount, B is -amount (or the reverse). The side is randomized so
        // the answer is about sound, not about always pressing A.
        const aSign = flip;
        t.current = { dim, aSign, bSign: -flip };
        this._applyTrainerGains(dim, aSign * amount, -flip * amount);
        this._setTrainerSide('A');
        this._renderTrainerRound();
    },

    _renderTrainerRound: function () {
        const stage = this._modal.querySelector('#pt-train-stage');
        const t = this._trainer;
        if (!stage || !t || !t.current) return;
        const pct = Math.round((t.round / t.total) * 100);
        stage.innerHTML = `
            <div class="flex items-center justify-between type-micro font-black uppercase tracking-wider mb-1" style="color:var(--text-lo);">
                <span>Round ${t.round + 1} / ${t.total}</span>
                <span>${esc(this._dimLabel(t.current.dim))}</span>
            </div>
            <div style="height:4px;background:var(--bg-input);border-radius:99px;overflow:hidden;margin-bottom:10px;"><div style="height:100%;width:${pct}%;background:var(--accent);"></div></div>
            <div class="pt-ab-row">
                <button id="pt-ab-a" type="button" class="pt-ab-btn is-on">A</button>
                <button id="pt-ab-b" type="button" class="pt-ab-btn">B</button>
                <button id="pt-ab-toggle" type="button" class="btn-clear cursor-pointer type-micro" style="height:38px;padding:0 10px;border-radius:var(--r-sm);" title="Switch between A and B">🔀</button>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-3">
                <button id="pt-pick-a" type="button" class="cta-primary no-tactile cursor-pointer" style="height:38px;border-radius:var(--r-sm);">Prefer A</button>
                <button id="pt-pick-b" type="button" class="cta-primary no-tactile cursor-pointer" style="height:38px;border-radius:var(--r-sm);">Prefer B</button>
            </div>
            <div class="flex justify-between mt-2.5">
                <button id="pt-train-stop" type="button" class="type-micro cursor-pointer" style="background:transparent;border:0;color:var(--text-lo);">Stop</button>
                <span class="type-micro" style="color:var(--text-lo);">The level is matched; only the tilt changes.</span>
            </div>`;
        const choose = (side) => this._chooseTrainerSide(side);
        stage.querySelector('#pt-ab-a').addEventListener('click', () => this._setTrainerSide('A'));
        stage.querySelector('#pt-ab-b').addEventListener('click', () => this._setTrainerSide('B'));
        stage.querySelector('#pt-ab-toggle').addEventListener('click', () => this._setTrainerSide(this._trainerSide === 'A' ? 'B' : 'A'));
        stage.querySelector('#pt-pick-a').addEventListener('click', () => choose('A'));
        stage.querySelector('#pt-pick-b').addEventListener('click', () => choose('B'));
        stage.querySelector('#pt-train-stop').addEventListener('click', () => this.stopTrainer(true));
    },

    _dimLabel: function (dim) {
        return ({ bass: 'Bass weight', treble: 'Treble energy', warmth: 'Lower-mid warmth', mid: 'Vocal presence', air: 'Air / sparkle' })[dim] || dim;
    },

    _chooseTrainerSide: function (side) {
        const t = this._trainer;
        if (!t || !t.active || !t.current) return;
        const sign = side === 'A' ? t.current.aSign : t.current.bSign;
        t.scores[t.current.dim] += sign;
        t.counts[t.current.dim] += 1;
        t.choices.push({ dim: t.current.dim, sign });
        t.round++;
        this._nextTrainerRound();
    },

    _finishTrainer: function () {
        const t = this._trainer;
        const values = {};
        ['bass', 'treble', 'warmth', 'mid', 'air'].forEach(k => {
            values[k] = t.counts[k] ? this._clamp((t.scores[k] / t.counts[k]) * 2.4, -3, 3) : 0;
        });
        const record = { rounds: t.round, values, updatedAt: Date.now() };
        this._writeJSON(this.TRAIN_KEY, record);
        this.stopTrainer(false);
        this._trainer = null;
        this.renderTrainerTab();
        showToast('Preference trainer complete — ' + this._trainedSummaryText(this._trainedPrefs()), '🧪', { duration: 6000 });
    },

    stopTrainer: function (announce) {
        if (this._trainer) this._trainer.active = false;
        this._stopTrainerAudio();
        if (announce) {
            this._trainer = null;
            this.renderTrainerTab();
            showToast('Trainer stopped — your existing result is unchanged.', '⏹️');
        }
    },

    _initTrainerAudio: function () {
        if (this._audioCtx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('Web Audio is unavailable.');
        const ctx = new Ctx({ latencyHint: 'interactive' });
        const sr = ctx.sampleRate;
        const dur = 4;
        const buffer = ctx.createBuffer(2, Math.floor(sr * dur), sr);
        for (let ch = 0; ch < 2; ch++) {
            const d = buffer.getChannelData(ch);
            let b0 = 0, b1 = 0, b2 = 0;
            const chord = [110, 164.81, 220, 277.18, 329.63, 440];
            for (let i = 0; i < d.length; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99765 * b0 + white * 0.0990460;
                b1 = 0.96300 * b1 + white * 0.2965164;
                b2 = 0.57000 * b2 + white * 1.0526913;
                const pink = (b0 + b1 + b2 + white * 0.1848) * 0.16;
                let tone = 0;
                const tw = (2 * Math.PI * i) / d.length;
                for (let k = 0; k < chord.length; k++) {
                    const f = chord[k];
                    // Quantize to the loop length so every partial closes exactly.
                    const cycles = Math.round(f * dur);
                    tone += Math.sin((2 * Math.PI * cycles * i) / d.length + k * 0.7) * (0.12 / (k + 1));
                    tone += Math.sin((2 * Math.PI * cycles * 2 * i) / d.length + k) * (0.035 / (k + 1));
                }
                const pulse = 0.72 + 0.28 * Math.sin(tw * 2 + (ch ? 1.2 : 0));
                d[i] = (pink + tone) * pulse * 0.8;
            }
            // Loop without a click: crossfade the tail into the head.
            const fade = Math.floor(sr * 0.04);
            for (let i = 0; i < fade; i++) {
                const a = i / fade;
                d[i] = d[i] * a + d[d.length - fade + i] * (1 - a);
            }
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const specs = [
            { type: 'lowshelf', hz: 105, q: 0.7 },
            { type: 'peaking', hz: 250, q: 0.9 },
            { type: 'peaking', hz: 2600, q: 1.3 },
            { type: 'highshelf', hz: 5500, q: 0.7 },
            { type: 'highshelf', hz: 11000, q: 0.7 }
        ];
        const makeChain = () => {
            const filters = specs.map(s => {
                const f = ctx.createBiquadFilter();
                f.type = s.type; f.frequency.value = s.hz; f.Q.value = s.q; f.gain.value = 0;
                return f;
            });
            const gain = ctx.createGain();
            gain.gain.value = 0;
            for (let i = 0; i < filters.length; i++) {
                if (i === 0) source.connect(filters[i]); else filters[i - 1].connect(filters[i]);
            }
            filters[filters.length - 1].connect(gain);
            gain.connect(ctx.destination);
            return { filters, gain };
        };
        const chainA = makeChain();
        const chainB = makeChain();
        this._audioCtx = ctx;
        this._audioSource = source;
        this._audioChains = { A: chainA, B: chainB };
        this._trainerSide = 'A';
        source.start(0);
        // Honour the app's output-device choice where Chromium supports it.
        try {
            const saved = localStorage.getItem('settings_audio_output');
            if (saved && typeof ctx.setSinkId === 'function') ctx.setSinkId(saved).catch(() => {});
        } catch (e) {}
    },

    _applyTrainerGains: function (dim, gainA, gainB) {
        const chains = this._audioChains;
        if (!chains) return;
        const info = {
            bass: { index: 0 }, warmth: { index: 1 }, mid: { index: 2 },
            treble: { index: 3 }, air: { index: 4 }
        }[dim];
        if (!info) return;
        const now = this._audioCtx.currentTime;
        const set = (chain, value) => {
            chain.filters.forEach((f, i) => {
                f.gain.cancelScheduledValues(now);
                f.gain.setTargetAtTime(i === info.index ? value : 0, now, 0.03);
            });
        };
        set(chains.A, gainA);
        set(chains.B, gainB);
    },

    _setTrainerSide: function (side) {
        this._trainerSide = side;
        const chains = this._audioChains, ctx = this._audioCtx;
        if (!chains || !ctx) return;
        const now = ctx.currentTime;
        chains.A.gain.gain.setTargetAtTime(side === 'A' ? 0.9 : 0, now, 0.02);
        chains.B.gain.gain.setTargetAtTime(side === 'B' ? 0.9 : 0, now, 0.02);
        const a = this._modal && this._modal.querySelector('#pt-ab-a');
        const b = this._modal && this._modal.querySelector('#pt-ab-b');
        if (a) a.classList.toggle('is-on', side === 'A');
        if (b) b.classList.toggle('is-on', side === 'B');
    },

    _stopTrainerAudio: function () {
        try { if (this._audioSource) this._audioSource.stop(); } catch (e) {}
        try { if (this._audioCtx && this._audioCtx.state !== 'closed') this._audioCtx.close(); } catch (e) {}
        this._audioSource = null;
        this._audioCtx = null;
        this._audioChains = null;
    },

    // --------------------------------------------------------------- Coach ----
    renderFixTab: function () {
        const body = this._modal.querySelector('#my-sound-body');
        if (typeof EQ_Module === 'undefined' || typeof EQ_Module.renderCoachPanel !== 'function') {
            body.innerHTML = '<div class="type-xs" style="color:var(--text-mid);">The coach is unavailable because the EQ module did not load.</div>';
            return;
        }
        EQ_Module.renderCoachPanel(body);
    }
};

if (typeof window !== 'undefined') window.PersonalTargets = PersonalTargets;

// Attach the entry points after all method-set files have been concatenated.
// A DOMContentLoaded guard is used because the bundle can execute after the DOM
// is already parsed (it is appended at the end of <body>).
(function () {
    const boot = () => {
        try { PersonalTargets.install(); } catch (e) { console.warn('[My Sound] install failed', e); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
