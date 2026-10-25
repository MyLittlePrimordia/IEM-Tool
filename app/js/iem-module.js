// Width below which the workspace shows ONE section at a time instead of three
// columns. This was hard-coded as `window.innerWidth < 1280` in four places
// (setIemSection / setFindSection / setEqSection / setTestLabSection).
// main.js opens the window at min(1600, screenWidth * 0.9), so on a 1366x768
// display that is about 1229 CSS px - under 1280 - which meant ordinary laptops
// silently got the phone layout: two of the three columns were set to
// display:none, so only the left column appeared and every control inside the
// hidden columns, including sliders, stopped painting.
//
// Raised to 1000 so the three-column workspace survives on laptops; narrower
// than that (phones) keeps the single-section behaviour, which is what it was
// written for. Must stay in step with the matching breakpoint in app.css 8.18.
const RESPONSIVE_SECTION_BREAKPOINT_PX = 1000;

// Split out of the former monolithic app-core.js (2026 refactor).
// A few small shared helpers (getBandEnergy, debounce, rafThrottle, etc.)
// followed by IEM_Module (the review-card / IEM-info builder tab). Kept
// together because they sat immediately adjacent in the original file.

function getBandEnergy(dataArray, startBin, endBin) {
    var sum = 0;
    for (var i = startBin; i <= endBin; i++) {
        sum += dataArray[i] || 0;
    }
    return sum / (endBin - startBin + 1) / 255;
}

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    }

    function rafThrottle(func) {
        let scheduled = false;
        let lastArgs = null;
        return function throttled(...args) {
            lastArgs = args;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                func.apply(this, lastArgs);
            });
        };
    }

    function setAudioParamSmooth(audioParam, value, timeConstant = 0.015) {
        if (audioParam) {
            // Boundary guard: a NaN/Infinity (e.g. parseFloat('') from a
            // cleared volume field) makes setTargetAtTime throw a RangeError,
            // and the old fallback `audioParam.value = value` then threw a
            // second, uncaught one. Drop non-finite targets here.
            if (typeof value !== 'number' || !Number.isFinite(value)) return;
            if (SharedAudio.ctx && SharedAudio.ctx.state !== 'suspended') {
                const now = SharedAudio.ctx.currentTime;
                try {

                    audioParam.setTargetAtTime(value, now, timeConstant);
                } catch (e) {
                    try { audioParam.value = value; } catch (_) {}
                }
            } else {
                try { audioParam.value = value; } catch (_) {}
            }
        }
    }

    function showToast(message, icon = "ℹ️", opts) {
        opts = opts || {};
        const stack = document.getElementById('toast-stack');
        if (!stack) return;

        const text = String(message == null ? '' : message);
        const glyph = icon || 'ℹ️';

        const dismiss = (el, immediate) => {
            clearTimeout(el.timeoutId);
            if (immediate || !el.parentNode) { el.remove(); return; }
            el.style.transition = 'opacity .25s ease, transform .25s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-6px)';
            // Kept on the element so a keyed update that lands mid-fade can
            // cancel the removal; otherwise the new message would inherit the
            // old toast's exit and vanish in 260ms.
            el.removeTimer = setTimeout(() => { if (el.parentNode) el.remove(); }, 260);
        };

        // A keyed toast REPLACES its own previous entry instead of stacking a
        // second one. Stepping the Output device is one action repeated, not a
        // series of independent messages: tapping ▶ four times used to leave
        // four entries naming devices the user had already stepped past, and
        // the stack grew to a third of the screen for a one-word change.
        const key = opts.key ? String(opts.key) : '';
        let item = null;
        if (key) {
            for (const el of stack.children) {
                if (el.dataset && el.dataset.toastKey === key) { item = el; break; }
            }
        }

        if (item) {
            clearTimeout(item.timeoutId);
            clearTimeout(item.removeTimer);
            // Undo any exit animation already in flight, or the fresh message
            // would fade with the old one.
            item.style.transition = 'none';
            item.style.opacity = '';
            item.style.transform = '';
            const iconEl = item.querySelector('.toast-icon');
            const textEl = item.querySelector('.toast-msg');
            if (iconEl) iconEl.textContent = glyph;
            if (textEl) textEl.textContent = text;
            // Replay the entry so the update still reads as a change.
            item.style.animation = 'none';
            void item.offsetWidth;
            item.style.animation = 'toast-in .18s ease-out';
        } else {
            // Cap the number of visible toasts — evict the oldest first.
            while (stack.children.length >= 6) {
                const first = stack.firstElementChild;
                if (first) { clearTimeout(first.timeoutId); first.remove(); }
            }

            item = document.createElement('div');
            item.className = 'toast-item pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 border-2 border-black bg-[var(--bg-card)] text-[var(--text-main)] shadow-[4px_4px_0_0_#000] text-xs font-bold select-none';
            item.style.animation = 'toast-in .18s ease-out';
            if (key) item.dataset.toastKey = key;

            const action = opts.action;
            let html = '<span class="toast-icon flex-shrink-0 leading-none">' + esc(glyph) + '</span>';
            html += '<div class="toast-msg min-w-0 flex-1 leading-snug break-words">' + esc(text) + '</div>';
            if (action && action.label) {
                html += '<button class="toast-act flex-shrink-0 px-2 py-1 border-2 border-black bg-[var(--accent-blue)] text-white type-micro font-black cursor-pointer hover:brightness-110">' + esc(action.label) + '</button>';
            }
            html += '<button class="toast-x flex-shrink-0 text-zinc-500 hover:text-red-400 type-micro leading-none cursor-pointer">✕</button>';
            item.innerHTML = html;

            const actBtn = item.querySelector('.toast-act');
            if (actBtn && action) {
                actBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    dismiss(item);
                    if (typeof action.onClick === 'function') {
                        try { action.onClick(); } catch (e) { console.error('toast action', e); }
                    }
                };
            }
            const xBtn = item.querySelector('.toast-x');
            if (xBtn) xBtn.onclick = (ev) => { ev.stopPropagation(); dismiss(item); };

            item.addEventListener('click', (ev) => {
                if (ev.target.closest && ev.target.closest('.toast-act, .toast-x')) return;
                dismiss(item);
            });

            stack.appendChild(item);
        }

        // Also mirror the text into the dedicated live region. The stack itself
        // is role=status, but entries can be evicted/removed quickly; the
        // announcer guarantees the message is announced exactly once.
        const announcer = document.getElementById('a11y-announcer');
        if (announcer) {
            announcer.textContent = '';
            setTimeout(() => { announcer.textContent = text; }, 30);
        }
        const duration = opts.action ? (opts.duration || 6000) : (opts.duration || 2600);
        item.timeoutId = setTimeout(() => dismiss(item), duration);
    }

    window.toggleAudioMode = function() {
        window.isMonoMode = !window.isMonoMode;
        const btn = document.getElementById('a11y-audio-btn');
        // R3: textContent, not innerHTML, and no leading emoji. The settings row
        // already carries a 🔊 icon, so repeating it inside the control was
        // redundant, and rewriting markup wholesale is exactly what previously
        // stopped this button from ever holding real structure.
        if (btn) btn.textContent = window.isMonoMode ? 'Mono' : 'Stereo';
        // Persisted like the Accessibility row next to it (a11y_bluelight). It was
        // session-only, so the box said Mono until the next launch and then
        // silently went back to Stereo - the one thing a one-click toggle must
        // not do. Accessibility.init restores it, and SharedAudio.init applies
        // it to a graph that did not exist yet.
        try { localStorage.setItem('settings_audio_mode', window.isMonoMode ? 'mono' : 'stereo'); } catch (e) {}
        if (SharedAudio.masterGain) {
            if (window.isMonoMode) {
                SharedAudio.masterGain.channelCount = 1;
                SharedAudio.masterGain.channelCountMode = 'explicit';
            } else {
                SharedAudio.masterGain.channelCount = 2;
                SharedAudio.masterGain.channelCountMode = 'max';
            }
        }

        var el = document.getElementById('brand-icon-emoji');
        if (el && window.isMonoMode) {
            el.textContent = '🦻';
            el.style.fontSize = '22px';
            el.style.lineHeight = '1';
            el.className = 'inline select-none emoji-font anim-mascot-idle';
            setTimeout(function() { Mascot.update(); }, 1500);
        } else if (el && !window.isMonoMode) {
            el.textContent = '🔊';
            el.style.fontSize = '22px';
            el.style.lineHeight = '1';
            el.className = 'inline select-none emoji-font anim-mascot-sparkle';
            setTimeout(function() { Mascot.update(); }, 1200);
        }
    };

window.updateExpandedAutoHide = function() {
    const isAnyExpanded = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
    const footer = document.getElementById('global-footer-bar');
    if (!footer) return;

    if (isAnyExpanded) {
        footer.style.zIndex = '999999';
        if (!window._expandedMouseMoveBound) {
            window._expandedMouseMoveBound = true;
            window._expandedHideTimer = null;
            window._onExpandedMouseMove = () => {
                const active = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
                if (!active) return;

                if (footer) {
                    footer.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                    footer.style.transform = 'translateY(0)';
                    footer.style.opacity = '1';
                    footer.style.pointerEvents = 'auto';
                }

                clearTimeout(window._expandedHideTimer);
                window._expandedHideTimer = setTimeout(() => {
                    const stillActive = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
                    if (stillActive && footer) {
                        footer.style.transform = 'translateY(150%)';
                        footer.style.opacity = '0';
                        footer.style.pointerEvents = 'none';
                    }
                }, 2500);
            };
            window.addEventListener('mousemove', window._onExpandedMouseMove);
        }

        if (footer) {
            footer.style.transform = 'translateY(150%)';
            footer.style.opacity = '0';
            footer.style.pointerEvents = 'none';
        }
    } else {
        clearTimeout(window._expandedHideTimer);
        if (footer) {
            footer.style.zIndex = '';
            footer.style.transition = '';
            footer.style.transform = '';
            footer.style.opacity = '';
            footer.style.pointerEvents = '';
        }
    }
};

    const App = {
    domCache: new Map(),
    getEl: function(id) {
        if (!this.domCache.has(id)) {
            this.domCache.set(id, document.getElementById(id));
        }
        return this.domCache.get(id);
    },
    saveWorkspaceState: function() {
        // Persist the hearing-test correction so it survives reloads. The
        // hearing layer is a separate EQ layer (worklet sim slots 12-19,
        // included in exports), so restoring it re-applies the exact profile
        // the user measured without touching their faders.
        try {
            if (window.EQ && EQ_Module.hearingCalEnabled && Array.isArray(EQ_Module.hearingOffsets)) {
                const anyNonZero = EQ_Module.hearingOffsets.some(v => v !== 0);
                if (anyNonZero) {
                    localStorage.setItem('settings_hearing_offsets', JSON.stringify(EQ_Module.hearingOffsets));
                } else {
                    localStorage.removeItem('settings_hearing_offsets');
                }
            } else {
                localStorage.removeItem('settings_hearing_offsets');
            }
        } catch (e) { /* storage full — non-fatal */ }
    },
    restoreHearingCorrection: function() {
        // Boot-time counterpart of saveWorkspaceState. Re-applies the saved
        // hearing layer (and lights the UI badges) without re-running the test.
        try {
            const saved = localStorage.getItem('settings_hearing_offsets');
            if (!saved) return false;
            const offsets = JSON.parse(saved);
            if (!Array.isArray(offsets) || offsets.length !== 8 || !offsets.some(v => Number.isFinite(v) && v !== 0)) return false;

            EQ_Module.hearingOffsets = offsets.map(v => (Number.isFinite(v) ? Math.max(0, Math.min(6, v)) : 0));
            EQ_Module.hearingCalEnabled = true;

            // Reflect the restored profile in the Test Lab panel state.
            const genBtn = document.getElementById('hearing-eq-generate-btn');
            if (genBtn) {
                // 7.5 moved this button off a hand-picked emerald pair onto the
                // accent ramp plus .is-ready. Re-adding bg-emerald-500 here put
                // the rejected ~2.4:1 fill back whenever a saved profile was
                // restored, so the same button had two looks depending on how
                // the session started.
                genBtn.classList.remove('hidden', 'bg-emerald-500', 'text-white',
                                        'hover:brightness-110', 'cursor-not-allowed');
                genBtn.classList.add('is-ready', 'cursor-pointer');
                genBtn.disabled = false;
            }
            const status = document.getElementById('hearing-test-status');
            if (status) status.textContent = 'Saved hearing profile active.';
            const hzDisp = document.getElementById('hearing-test-hz');
            if (hzDisp) hzDisp.textContent = 'SAVED';
            const pctDisp = document.getElementById('hearing-progress-pct');
            if (pctDisp) pctDisp.textContent = '100%';
            const fill = document.getElementById('hearing-progress-fill');
            if (fill) fill.style.width = '100%';
            const instr = document.getElementById('hearing-test-instruction');
            if (instr) {
                instr.innerHTML = 'Saved correction active. <span class="text-white font-bold">Start Test</span> re-measures · <span class="text-white font-bold">Reset</span> clears.';
            }

            // Mirror raw thresholds into TestLab so a re-run of
            // convertHearingToEQ has sane source data (offsets are the
            // capped/shaped version of thresholds; re-deriving thresholds
            // from them is not exact — but bake-to-faders uses offsets).
            if (window.TestLab && TestLab_Module) {
                TestLab_Module.hearingThresholds = offsets.map(v => v * 2.5); // loss*0.4 inverse, approx
            }

            EQ_Module.applyHearingCalibrationGains();
            return true;
        } catch (e) {
            console.warn('[Hearing] Restore failed:', e);
            return false;
        }
    },
    // U-006: Settings > Output device. The list comes from the real
    // enumerateDevices() call (labels and sink IDs are exposed in Electron) and
    // the row is a cycle button like Theme / Font / Audio channel: one control,
    // one line, no popup. -1 means "System default".
    //
    // It was a ◀ value ▶ stepper for one iteration; that was three targets in a
    // pane the rest of which is click-to-cycle, so it read as a different kind of
    // control. One button that steps forward matches its neighbours, and the
    // device list is short enough that clicking round it is the normal gesture.
    _audioOutputs: [],
    _audioOutputIndex: -1,

    initAudioOutputs: async function() {
        const btn = document.getElementById('audio-output-btn');
        if (!btn) return;
        let saved = '';
        try { saved = localStorage.getItem('settings_audio_output') || ''; } catch (e) {}
        try {
            const devices = await SharedAudio.listOutputDevices();
            const seen = new Set();
            const list = [];
            devices.forEach((d) => {
                // Windows lists each endpoint three times: a synthetic "Default"
                // and "Communications" entry plus the physical device. Windows'
                // own picker shows only the physical one, and "System default"
                // already means "whatever Windows uses now", so the two aliases
                // only add duplicates. Empty IDs mean the permission check never
                // exposed names (non-Electron hosts): those could not switch
                // anything, so they are skipped too.
                if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') return;
                if (seen.has(d.deviceId)) return;
                seen.add(d.deviceId);
                list.push({ id: d.deviceId, label: d.label || `Output ${seen.size}` });
            });
            // Windows names read "3 - AG276QZD2 (2- AMD High Definition Audio
            // Device)", and a USB DAC arrives with TWO trailing groups - its
            // chipset and the endpoint id ("Wired IEMs (CX31993+MAX97220
            // HiFiAudio) (06cb:1595)"). The adapter group can contain its own
            // parentheses ("Speakers (Realtek(R) Audio)"), which a single
            // [^()]* group cannot match at all, so the old one-group strip left
            // the chipset on screen and only removed the id.
            //
            // Everything from the first " (" is dropped instead: the endpoint
            // number, the adapter and the id are all noise on a one-line button.
            // A name that is nothing but a group ("(Unknown)") keeps its label
            // rather than becoming empty, and only when the short form is still
            // unique - two "Speakers" entries would be indistinguishable and
            // the click would move the sink to the wrong one, so a collision
            // falls back to the full name. The tooltip always carries the full
            // name either way (renderAudioOutput).
            const shortCounts = new Map();
            list.forEach((d) => {
                d.short = String(d.label).replace(/^\d+\s*-\s*/, '').replace(/\s+\(.*$/, '').trim() || d.label;
                shortCounts.set(d.short, (shortCounts.get(d.short) || 0) + 1);
            });
            list.forEach((d) => { if (shortCounts.get(d.short) > 1) d.short = d.label; });
            this._audioOutputs = list;
            this._audioOutputIndex = saved ? list.findIndex((d) => d.id === saved) : -1;
            if (saved && this._audioOutputIndex < 0) {
                // The saved device is gone; fall back to default rather than
                // leaving a stale value that silently fails on next launch.
                try { localStorage.removeItem('settings_audio_output'); } catch (e) {}
            }
            this.renderAudioOutput();
        } catch (e) {
            console.warn('[Audio] output device list unavailable:', e);
            // A failed FIRST load leaves the arrows looking usable (markup ships
            // them disabled, so this only matters if the list was emptied).
            // A failure after a good load keeps the list it already has rather
            // than relabelling a working sink as "System default".
            if (!this._audioOutputs || !this._audioOutputs.length) this.renderAudioOutput();
        }
        if (!btn._iemBound) {
            btn._iemBound = true;
            // The button itself is the affordance now, so Enter / Space already
            // cycle it. No arrow-key listener: on a single button those keys do
            // nothing, and capturing them only hid them from the page.
            if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
                // Plugging a DAC in must show up without a restart.
                navigator.mediaDevices.addEventListener('devicechange', () => { this.initAudioOutputs(); });
            }
        }
    },

    renderAudioOutput: function() {
        const btn = document.getElementById('audio-output-btn');
        if (!btn) return;
        const list = this._audioOutputs || [];
        const i = typeof this._audioOutputIndex === 'number' ? this._audioOutputIndex : -1;
        const cur = i >= 0 ? list[i] : null;
        const label = cur ? cur.short : 'System default';
        const full = cur ? cur.label : 'System default';
        const span = document.getElementById('audio-output-label');
        if (span) span.textContent = label; else btn.textContent = label;
        // The button ellipsises a long name, so the tooltip carries the full one
        // and says what a click does — the row has no separate label for that.
        btn.title = `${full} — click to switch`;
        btn.setAttribute('aria-label', `Output device: ${full}`);
        // Nothing to switch to. A disabled button says so before the click; an
        // enabled-looking one answered every press with "No output devices".
        btn.disabled = list.length === 0;
    },

    // One click = the next entry in [System default, ...devices], wrapping back
    // to System default after the last device.
    cycleAudioOutput: async function() {
        const list = this._audioOutputs || [];
        // Unreachable while the button is disabled, but kept as a guard rather
        // than throwing on an empty list.
        if (!list.length) return;
        const i = typeof this._audioOutputIndex === 'number' ? this._audioOutputIndex : -1;
        const next = i + 1 >= list.length ? -1 : i + 1;
        await this.setAudioOutput(next < 0 ? '' : list[next].id);
    },

    // U-008: app + measurement-database update center. All network work is in
    // main.js behind fixed, argument-less IPC commands; this layer only renders
    // state and asks before anything is installed.
    _updateStatus: function(text, tone) {
        const row = document.getElementById('update-status');
        const el = document.getElementById('update-status-text');
        if (!row || !el) return;
        row.style.display = text ? 'flex' : 'none';
        el.textContent = text || '';
        el.style.color = tone === 'bad' ? 'var(--danger)' : tone === 'good' ? 'var(--accent-green)' : 'var(--text-secondary)';
    },

    initUpdateCenter: async function() {
        // The old update centre stored the last remote database commit here and
        // treated it as "installed". Content hashes now decide, so the stale key
        // is removed rather than left to imply state that is no longer read.
        try { localStorage.removeItem('settings_db_commit'); } catch (e) {}
        const hint = document.getElementById('app-version-hint');
        const bridge = window.appBridge;
        if (!bridge || typeof bridge.checkAppUpdate !== 'function') {
            if (hint) hint.textContent = 'Updates require the desktop app';
            return;
        }
        try {
            if (typeof bridge.appBuildInfo === 'function') {
                const info = await bridge.appBuildInfo();
                if (info && info.ok) {
                    if (hint) hint.textContent = info.shortCommit
                        ? `Version ${info.version} · build ${info.shortCommit}`
                        : `Version ${info.version} · development build`;
                    return;
                }
            }
            const v = await bridge.appVersion();
            if (hint) hint.textContent = `Version ${v}`;
        } catch (e) {}
    },

    checkAppUpdate: async function() {
        const bridge = window.appBridge;
        if (!bridge || !bridge.checkAppUpdate) { showToast('Updates require the desktop app.', '⚠️'); return; }
        this._updateStatus('Checking for app updates…');
        const r = await bridge.checkAppUpdate();
        if (!r || !r.ok) {
            this._updateStatus('App update check failed: ' + ((r && r.error) || 'unknown error'), 'bad');
            showToast('Could not check for updates.', '⚠️');
            return;
        }
        if (r.dev) {
            this._updateStatus(`Development build · version ${r.current}. Release comparison is skipped.`, 'good');
            showToast('Development builds are not compared with released installers.', 'ℹ️');
            return;
        }
        if (!r.changed) {
            this._updateStatus(`Build ${r.localShort} is up to date.`, 'good');
            showToast(`Build ${r.localShort} matches the latest release.`, '✅');
            return;
        }
        const remote = r.remoteShort || r.latest;
        const local = r.localShort || r.current;
        this._updateStatus(`Update available: build ${remote} (you have ${local})`, 'good');
        const go = await UIKit.confirm({
            title: `Update available: build ${remote}`,
            message: `You are running build ${local}. The release page opens in your browser so you can download the installer for your platform.${r.notes ? '\n\n' + r.notes.slice(0, 500) : ''}`,
            confirmLabel: 'Open release page',
            cancelLabel: 'Later'
        });
        if (go) bridge.openReleasePage();
    },

    openReleasePage: function() {
        if (window.appBridge && window.appBridge.openReleasePage) window.appBridge.openReleasePage();
        else showToast('This only works in the desktop app.', '⚠️');
    },

    // A-008. Every curve comes from a person or publication; this is where the
    // app says who, and links to the original database instead of leaving the
    // folder name ("SUPER REVIEW") as the only trace of authorship.
    //
    // The list is rendered with DOM nodes rather than one innerHTML string: the
    // labels come from the measurement archive, and a quote or angle bracket in
    // a future folder name should be shown literally, not parsed as markup.
    openSourceCredits: function() {
        if (typeof SourceIndex === 'undefined' || typeof SourceIndex.creditList !== 'function') {
            showToast('Source credits are unavailable in this build.', '⚠️');
            return;
        }
        const credits = SourceIndex.creditList();
        if (!credits.length) {
            showToast('No measurement sources are listed.', '⚠️');
            return;
        }
        const self = this;

        UIKit.read({
            title: 'Measurement sources',
            subtitle: credits.length + ' reviewers, communities and archives · every curve belongs to its author',
            toolbar: function(bar) {
                const input = document.createElement('input');
                input.type = 'search';
                input.placeholder = 'Filter by name…';
                input.setAttribute('aria-label', 'Filter measurement sources');
                input.style.cssText = 'flex:1 1 200px;min-width:0;height:30px;padding:0 10px;background:var(--bg-card);border:1px solid var(--line);border-radius:var(--r-xs);color:var(--text-hi);font:inherit;font-size:var(--t-xs);outline:none;';
                bar.appendChild(input);
                const count = document.createElement('span');
                count.className = 'type-micro';
                count.style.cssText = 'flex:none;color:var(--text-mid);font-variant-numeric:tabular-nums;';
                count.textContent = credits.length + ' sources';
                bar.appendChild(count);

                // The body is built synchronously below, so the filter reads the
                // finished rows on the first input event.
                input.addEventListener('input', function() {
                    const q = String(input.value || '').trim().toLowerCase();
                    const rows = bar.parentElement.querySelectorAll('.source-credit-row');
                    let shown = 0;
                    rows.forEach(function(row) {
                        const match = !q || (row.getAttribute('data-search') || '').indexOf(q) !== -1;
                        row.style.display = match ? '' : 'none';
                        if (match) shown++;
                    });
                    count.textContent = q ? shown + ' of ' + credits.length : credits.length + ' sources';
                });
            },
            render: function(body) {
                const intro = document.createElement('p');
                intro.className = 'type-xs';
                intro.style.cssText = 'margin:0 0 10px;color:var(--text-mid);line-height:1.55;';
                intro.textContent = 'These people measured the curves. IEM Tool only normalises and re-plots them; the measurements remain the work of their authors. Sources are credited by the folder names stored in the measurement archive.';
                body.appendChild(intro);

                const list = document.createElement('div');
                list.className = 'source-credit-list';
                list.style.cssText = 'display:flex;flex-direction:column;';

                credits.forEach(function(credit) {
                    const row = document.createElement('div');
                    row.className = 'source-credit-row';
                    let host = '';
                    try { host = new URL(credit.url).hostname.replace(/^www\./, ''); } catch (e) { host = credit.url; }
                    row.setAttribute('data-search', [credit.label, host, credit.kind, credit.folders.join(' ')].join(' ').toLowerCase());
                    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:7px 2px;border-bottom:1px solid var(--line);';

                    const text = document.createElement('div');
                    text.style.cssText = 'flex:1 1 auto;min-width:0;';
                    const name = document.createElement('div');
                    name.className = 'type-sm';
                    name.style.cssText = 'font-weight:600;color:var(--text-hi);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    name.textContent = credit.label;
                    const meta = document.createElement('div');
                    meta.className = 'type-micro';
                    meta.style.cssText = 'margin-top:1px;color:var(--text-mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    meta.textContent = SourceIndex.kindLabel(credit.kind) + ' · ' + host;
                    text.appendChild(name);
                    text.appendChild(meta);

                    const open = document.createElement('button');
                    open.type = 'button';
                    open.className = 'settings-btn';
                    open.style.flex = 'none';
                    open.textContent = 'Open ↗';
                    open.title = 'Open ' + credit.label + ' in your browser';
                    open.setAttribute('aria-label', 'Open ' + credit.label + ' in your browser');
                    open.onclick = function() { self.openCreditUrl(credit.url); };

                    row.appendChild(text);
                    row.appendChild(open);
                    list.appendChild(row);
                });

                body.appendChild(list);

                const note = document.createElement('p');
                note.className = 'type-micro';
                note.style.cssText = 'margin:12px 0 0;color:var(--text-mid);line-height:1.5;';
                note.textContent = 'Missing or miscredited source? Open an issue on the project’s GitHub repository and it will be corrected.';
                body.appendChild(note);
            }
        });
    },

    // The URL comes from the local CREDITS table, but the main process still
    // validates its scheme and host: a compromised renderer must not be able to
    // turn this into an "open any URL" bridge. In a browser (the screenshot
    // harness) there is no appBridge, so a normal window.open is the fallback.
    openCreditUrl: function(url) {
        const bridge = window.appBridge;
        if (bridge && typeof bridge.openCreditUrl === 'function') {
            bridge.openCreditUrl(url).then(function(r) {
                if (!r || !r.ok) showToast('Could not open that source link.', '⚠️');
            }).catch(function() {
                showToast('Could not open that source link.', '⚠️');
            });
            return;
        }
        try {
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            if (win) win.opener = null;
        } catch (e) {
            showToast('Could not open that source link.', '⚠️');
        }
    },

    checkDatabaseUpdate: async function() {
        const bridge = window.appBridge;
        if (!bridge || !bridge.checkDatabaseUpdate) { showToast('Updates require the desktop app.', '⚠️'); return null; }
        const hint = document.getElementById('db-update-hint');
        this._updateStatus('Hashing the local database and comparing with GitHub…');
        const r = await bridge.checkDatabaseUpdate();
        if (!r || !r.ok) {
            this._updateStatus('Database check failed: ' + ((r && r.error) || 'unknown error'), 'bad');
            showToast('Could not check the database.', '⚠️');
            return null;
        }
        if (r.changed) {
            if (hint) hint.textContent = `New measurements · ${r.shortSha}`;
            this._updateStatus(`Database update available: ${r.shortSha} — ${r.message}`.slice(0, 160), 'good');
            showToast(`New database commit ${r.shortSha} is available.`, '🧬');
        } else {
            if (hint) hint.textContent = `Matches repository · ${r.shortSha}`;
            this._updateStatus(`Database matches commit ${r.shortSha}.`, 'good');
            showToast('Your measurement database is up to date.', '✅');
        }
        return r;
    },

    downloadDatabaseUpdate: async function() {
        const bridge = window.appBridge;
        if (!bridge || !bridge.downloadDatabaseUpdate) { showToast('Updates require the desktop app.', '⚠️'); return; }
        const latest = await this.checkDatabaseUpdate();
        if (!latest) return;
        if (!latest.changed) {
            showToast('The measurement database already matches GitHub.', '✅');
            return;
        }
        const ok = await UIKit.confirm({
            title: `Install database ${latest.shortSha}?`,
            message: 'The current database and measurements are backed up inside IEM-Data/backup first, and the download is verified against the commit hash before it replaces anything. The app reloads when the install finishes. This can take a minute on a slow connection.',
            confirmLabel: 'Download & install',
            cancelLabel: 'Cancel'
        });
        if (!ok) return;
        this._updateStatus('Downloading and installing the database… (this can take a minute)');
        const r = await bridge.downloadDatabaseUpdate();
        if (!r || !r.ok) {
            this._updateStatus('Database install failed: ' + ((r && r.error) || 'unknown error'), 'bad');
            showToast('Database update failed — your old database is still in place.', '⚠️', { duration: 7000 });
            return;
        }
        this._updateStatus(`Installed ${r.products} products from ${r.shortSha || latest.shortSha}. Reload to use it.`, 'good');
        const reload = await UIKit.confirm({
            title: 'Database installed',
            message: `${r.products} products from commit ${r.shortSha || latest.shortSha} are ready. Reload the app now to load the new measurements?`,
            confirmLabel: 'Reload now',
            cancelLabel: 'Later'
        });
        if (reload) {
            try { await CurveIndexer.clearCurveCache(); } catch (e) {}
            localStorage.removeItem('squig_db_indexed');
            localStorage.removeItem('find_canonical_profiles');
            location.reload();
        }
    },

    setAudioOutput: async function(deviceId) {
        const r = await SharedAudio.setOutputDevice(deviceId || '');
        if (!r.ok) {
            showToast('Could not switch output: ' + r.error, '⚠️');
            return;
        }
        const list = this._audioOutputs || [];
        const i = deviceId ? list.findIndex((d) => d.id === deviceId) : -1;
        this._audioOutputIndex = i;
        this.renderAudioOutput();
        const cur = i >= 0 ? list[i] : null;
        // Keyed so repeated steps update one entry rather than stacking a
        // history of devices the user has already stepped past.
        showToast(`Audio output: ${cur ? cur.short : 'System default'}`, '🎧', { key: 'audio-output' });
    },

    mobileDrawerOpen: false,
    toggleMobileDrawer: function() {
        this.mobileDrawerOpen = !this.mobileDrawerOpen;
        const drawer = document.getElementById('mobile-nav-drawer');
        if (drawer) {
            if (this.mobileDrawerOpen) {
                drawer.classList.remove('hidden');
            } else {
                drawer.classList.add('hidden');
            }
        }
    },
    toggleMobileSidebar: function() {
        this.toggleMobileDrawer();
    },
        isComicFont: false,
        themeMap: {},

        /*
         * === THE NINE THEMES (R0 — OLED reskin) =============================
         *
         * Display names are modernised; the `id` values are NOT, so every
         * existing `settings_theme_id` in a user's localStorage keeps resolving
         * and the legacy migration map in app-core-shared.js stays valid.
         *
         *   slate      -> Void       (default, True Black OLED)
         *   parchment  -> Bone       (converted from the old LIGHT theme)
         *   ember      -> Ember      circuit -> Circuit    byte -> Verdant
         *   cartridge  -> Amber      arcade  -> Nova       blush -> Orchid
         *   bit        -> Gold
         *
         * All nine share ONE base material: #000000 window, #0A0A0B cards,
         * #0E0E11 inputs, #212126 hairlines, #F2F3F5 / #9CA3AF text. Only the
         * accent differs, which is the point of an OLED palette.
         *
         * Every --accent below was measured against --bg-card #0A0A0B and
         * clears WCAG AA with headroom (7.1:1 to 14.3:1). The previous table
         * measured 2.22–7.39 and failed AA in five of nine themes, because
         * --accent-blue doubled as the colour of every 9px section header.
         *
         * The base-material values are repeated per theme on purpose: the review
         * card renderer reads `variables` directly, and repeating them keeps the
         * export correct at every stage gate. R9 collapses this to a single read
         * of the live computed style.
         */
        /* Themes are named for their accent colour, and each carries a distinct
           backdrop pattern as well as its own hue, so the theme is identifiable
           before you read a single label.

           The ids are deliberately NOT the colour names. They are persisted
           (localStorage settings_theme_id), referenced by the .theme-* selectors
           in app.css that key every per-theme backdrop, and used to switch the
           export-card renderer. Renaming them would silently reset every
           existing user's saved theme and orphan nine CSS selectors, for no
           user-visible gain - so id and display name are allowed to differ.

           Four accents were retuned so the display name is accurate:
             slate  was #5AA9E6 (light blue) and is named Black, so it took a
                    neutral grey - a saturated accent glows against an OLED
                    black and would read as a colour theme, not a monochrome one.
             ember  was #F87171, a salmon that sat too close to Pink; deepened.
             bit    was #E3B341 (gold), which reads as Yellow and collided with
                    cartridge; moved to a true orange.
             parchment was #E8DCC8, a cream so close to Black's grey that the two
                    were hard to tell apart. It is now a muted, darker brown.
                    Brown was preferred over Cyan because its hue (~35deg) sits
                    between Orange (~28deg) and Yellow (~43deg): the collision
                    is only a problem for a bright orange-brown, so the accent
                    is deliberately desaturated and darker than both rather than
                    a vivid hue. Cyan also wanted a Unicode 15.0 glyph (U+1FA75),
                    the same version as the pink heart that had to be replaced.

           Emoji are chosen for render coverage, not just looks: the pink heart
           (U+1FA77) and cyan heart (U+1FA75) are Unicode 15.0 and fall back to
           tofu on older Windows and some Linux font stacks, so Pink uses the
           cherry blossom (U+1F338) instead. */
          builtInThemes: IEM_BUILTIN_THEMES,
        loadDynamicThemes: function() {

        },
        fontMap: {},
        fontMeta: [],

        /*
         * Metric-normalisation baseline. R0 moved this from 'Silkscreen' to
         * 'JetBrains Mono', which is now the out-of-the-box default font: the
         * baseline font is the one whose calculated scale is pinned to 1.0, so
         * moving it is what keeps the default UI from being auto-scaled.
         *
         * JetBrains Mono is monospaced, so it occupies the same metric role
         * Silkscreen did — the dense numeric layout (92 spec chips, 60+ sliders,
         * 40 number inputs) does not reflow when it becomes the default.
         */
    BASELINE_FONT_NAME: 'JetBrains Mono',
        calculateFontMetrics: function(fontName, baselineFamily) {
            try {
                const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                const refFamily = baselineFamily || "system-ui, -apple-system, sans-serif";

                ctx.font = `72px ${refFamily}`;
                const refM = ctx.measureText(testString);
                const refW = refM.width;
                const refH = (refM.actualBoundingBoxAscent || 50) + (refM.actualBoundingBoxDescent || 12);

                ctx.font = `72px "${fontName}", sans-serif`;
                const customM = ctx.measureText(testString);
                const customW = customM.width;
                const customH = (customM.actualBoundingBoxAscent || 50) + (customM.actualBoundingBoxDescent || 12);

                if (!customW || !refW) return { scale: 1.0, letterSpacing: 'normal' };

                const wRatio = refW / customW;
                const hRatio = refH / customH;

                let fontScale = Math.min(wRatio, hRatio);

                fontScale = Math.max(0.7, Math.min(1.3, fontScale));

                let spacing = "normal";
                if (wRatio < 0.82) spacing = "-0.03em";
                else if (wRatio > 1.18) spacing = "0.03em";

                return {
                    scale: parseFloat(fontScale.toFixed(2)),
                    letterSpacing: spacing
                };
            } catch (e) {
                return { scale: 1.0, letterSpacing: 'normal' };
            }
        },
        loadDynamicFonts: async function() {
            try {
                var res = await fetch('./app/fonts/fonts.json');
                if (!res.ok) throw new Error("Could not find fonts.json");
                var fontList = await res.json();

                this.fontMap = {};
                this.fontMeta = [];

                const loadedEntries = [];
                for (var i = 0; i < fontList.length; i++) {
                    var f = fontList[i];
                    if (!f.file || f.file.includes(',')) {
                        loadedEntries.push({ meta: f, isSystemStack: true });
                        continue;
                    }
                    try {
                        var fontFace = new FontFace(f.name, 'url(./app/fonts/' + f.file + ')');
                        await fontFace.load();
                        document.fonts.add(fontFace);
                        loadedEntries.push({ meta: f, isSystemStack: false });
                    } catch (fontErr) {
                        console.warn(`[Offline Font Notice] Local font "${f.name}" (${f.file}) not found in ./app/fonts/. Falling back.`);
                    }
                }

                const baselineEntry = loadedEntries.find(e => !e.isSystemStack && e.meta.name === this.BASELINE_FONT_NAME);
                const baselineFamily = baselineEntry ? `"${this.BASELINE_FONT_NAME}", sans-serif` : "system-ui, -apple-system, sans-serif";

                for (var j = 0; j < loadedEntries.length; j++) {
                    const entry = loadedEntries[j];
                    const f = entry.meta;

                    if (entry.isSystemStack) {
                        this.fontMap[f.name] = f.file || 'system-ui, -apple-system, sans-serif';
                        this.fontMeta.push({
                            id: f.name, name: f.name, emoji: f.emoji || '🔤',
                            scale: 1.0, letterSpacing: 'normal'
                        });
                        continue;
                    }

                    this.fontMap[f.name] = '"' + f.name + '", sans-serif';

                    const metrics = (f.name === this.BASELINE_FONT_NAME)
                        ? { scale: 1.0, letterSpacing: 'normal' }
                        : this.calculateFontMetrics(f.name, baselineFamily);

                    this.fontMeta.push({
                        id: f.name,
                        name: f.name,
                        emoji: f.emoji || '🔤',
                        scale: metrics.scale,
                        letterSpacing: metrics.letterSpacing
                    });
                }

                if (Object.keys(this.fontMap).length === 0) {
                    this.useSystemFontsFallback();
                }
            } catch (err) {
                console.warn("Fonts loading failed.", err);
                this.useSystemFontsFallback();
            }
        },
		        useSystemFontsFallback: function() {
            this.fontMap = {
                "System UI": "system-ui, sans-serif"
            };
            this.fontMeta = [{
                id: "System UI",
                name: "System UI",
                emoji: "💻",
                scale: 1.0,
                letterSpacing: "normal"
            }];
        },
        currentTheme: 'slate',

        switchTab: function(tabId) {
            if (tabId !== 'visualizer' && window.EQ && EQ.isVizFullscreen) {
                EQ.exitVisualizerFullscreen();
            }
            try {

                const iemWrapper = document.getElementById('pane-iem-outer-wrapper');
                if (iemWrapper) iemWrapper.classList.toggle('hidden', tabId !== 'iem');

                ['iem', 'eq', 'testlab', 'visualizer', 'settings', 'find', 'database'].forEach(id => {
                    const pane = document.getElementById(`pane-${id}`);
                    if (pane) pane.classList.add('hidden');
                    const btn = document.getElementById(`tab-${id}-btn`);
                    if (btn) {
                        btn.classList.remove('bg-zinc-800', 'text-white', 'shadow-sm', 'is-on');
                        btn.classList.add('text-[var(--text-secondary)]');
                        btn.style.backgroundColor = '';
                        btn.style.boxShadow = '';
                        btn.style.transform = '';
                    }
                });
                const activePane = document.getElementById(`pane-${tabId}`);
                if (activePane) activePane.classList.remove('hidden');
                const activeBtn = document.getElementById(`tab-${tabId}-btn`);
                if (activeBtn) {
                    activeBtn.classList.remove('text-[var(--text-secondary)]', 'text-white');
                    activeBtn.classList.add('shadow-sm');
                }

                // Active-tab appearance is driven by .is-active-tab in the
                // stylesheet, not by inline styles written here.
                //
                // Two reasons. First, `.app-nav .app-tab` sets
                // `background: transparent !important`, and an !important
                // declaration in a stylesheet beats an inline style - so the
                // accent written to style.backgroundColor here was computed
                // straight back to transparent and the active tab showed no
                // accent at all. Second, the inline value was captured from
                // localStorage at switch time, so it could not track a theme
                // change; the class plus tokens always reflects the live theme.
                ['find', 'eq', 'testlab', 'iem', 'database', 'visualizer', 'settings'].forEach(id => {
                    const b = document.getElementById(`tab-${id}-btn`);
                    if (!b) return;
                    b.classList.toggle('is-active-tab', id === tabId);
                    b.style.backgroundColor = '';
                    b.style.color = '';
                    b.style.boxShadow = '';
                    b.style.transform = '';
                });
                if (tabId === 'eq' && EQ_Module) {
                setTimeout(() => {
                    const cv = document.getElementById("eq-squiglinkViz");
                    if (cv && cv.clientWidth > 0) {
                        EQ_Module.drawCurve();
                    } else {

                        setTimeout(() => EQ_Module.drawCurve(), 200);
                    }
                }, 100);
            }
                if (tabId === 'iem' && window.IEM) {
                    IEM.ensureChartReady();
                }
                if (tabId === 'database' && typeof DataTab !== 'undefined') {
                    DataTab.onShow();
                }
                // typeof guard: FindEngine is a top-level const in the
                // bundle, never assigned to window — the old window.FindEngine
                // check was always false, so returning to the Find tab never
                // re-drew the target viz or re-applied the mobile section.
                if (tabId === 'find' && typeof FindEngine !== 'undefined' && FindEngine.drawTargetVisualization) {
                setTimeout(() => {
                    FindEngine.drawTargetVisualization();
                    App.setFindSection(App.activeFindSection);
                }, 50);
            }
            if (tabId === 'eq' && PEQDB_Module.searchMode === 'similar') {
                setTimeout(() => {
                    PEQDB_Module.similarDirty = true;
                    PEQDB_Module.findSimilarCurves();
                }, 100);
            }
                if (tabId === 'visualizer' && EQ_Module) {
                    // `window.SharedAudio` was always undefined (SharedAudio is
                    // a top-level const, never a window property), so switching
                    // to the Visualizer tab never resumed a suspended context.
                    if (typeof SharedAudio !== 'undefined' && SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume().catch(()=>{});
                    }
                    // Fix frozen-every-other-switch: App previously forced
                    // vizLoopRunning=false then rAF→startVisualizer. The running
                    // drawViz loop sets vizLoopRunning=true before that rAF fires,
                    // so startVisualizer cancelled the loop's next tick and then
                    // early-returned with vizLoopRunning still true but no rAF
                    // scheduled → frozen. Only start if loop is actually dead.
                    if (!EQ_Module.vizLoopRunning) {
                        requestAnimationFrame(() => EQ_Module.startVisualizer());
                    } else if (!EQ_Module.vizFrameId && !EQ_Module._vizIdleTimer) {
                        EQ_Module.vizLoopRunning = false;
                        requestAnimationFrame(() => EQ_Module.startVisualizer());
                    }
                }
                if (window.TestLab) {
                    if (tabId === 'testlab') {
                        if (TestLab.spatialOrbitActive) {
                            TestLab.startSpatialOrbit();
                        }
                        const hasActiveSignal = TestLab.activeNodes.length > 0 || TestLab.hearingOsc || TestLab.channelToneOsc;
                        if (hasActiveSignal) {
                            TestLab.startImbalanceMeter();
                        }
                    } else {
                        TestLab.stopSpatialOrbitTimerOnly();
                        if (TestLab.imbalanceInterval) {
                            clearInterval(TestLab.imbalanceInterval);
                            TestLab.imbalanceInterval = null;
                        }
                        // Every Test Lab tone generator (resonance sweep,
                        // hearing test, channel-balance tone, stereo leak
                        // test, spatial/A-B playback) is designed to be
                        // stopped by its own Stop control -- there was no
                        // guard here, so navigating away mid-test left them
                        // playing indefinitely with no visible way to reach
                        // Stop. Burn-in is the one deliberate exception
                        // (long-duration background signal), preserved via
                        // stopAll's second argument.
                        if (TestLab.resonanceInterval || TestLab.hearingOsc || TestLab.channelToneOsc ||
                            TestLab.oscL || TestLab.oscR || TestLab.leakTestActive ||
                            TestLab.spatialActive || TestLab.abPlaying ||
                            (TestLab.activeNodes && TestLab.activeNodes.length > 0)) {
                            TestLab.stopAll(false, true);
                        }
                    }
                }
            } catch (error) {
                console.error("Tab switching failed:", error);
            }
        },

        renderThemeToggles: function() {
            // (the theme-toggles container was removed from the markup; theme
            // selection now lives in the Settings theme grid)
        },

        cycleTheme: function() {
            if (window.App_Theme) return App_Theme.cycleTheme.call(this);
            const keys = Object.keys(this.themeMap);
            const current = localStorage.getItem('settings_theme_id') || 'slate';
            let nextIdx = (keys.indexOf(current) + 1) % keys.length;
            if (nextIdx < 0 || nextIdx >= keys.length) nextIdx = 0;
            this.setGlobalTheme(keys[nextIdx]);
        },
        getContrastTextColor: function(hex) {
            if (window.App_Theme) return App_Theme.getContrastTextColor(hex);
            try {
                if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return '#ffffff';
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                return luminance > 0.6 ? '#000000' : '#ffffff';
            } catch (e) {
                return '#ffffff';
            }
        },
setGlobalTheme: function(themeId) {
            if (window.App_Theme) return App_Theme.setGlobalTheme.call(this, themeId);
            try {
                const t = (this.themeMap && this.themeMap[themeId]) ? this.themeMap[themeId] : this._defaultThemeEntry();
                this.currentTheme = this.themeMap[themeId] ? themeId : 'slate';

                const root = document.documentElement;

                if (t.variables) {
                    Object.entries(t.variables).forEach(([key, val]) => {
                        root.style.setProperty(key, val);
                    });
                }

                document.documentElement.className = 'theme-' + themeId;

                                const accentColor = t.accent || (t.variables && t.variables['--accent-blue']) || '#5AA9E6';
                const rgbStr = (typeof PEQDB_Module !== 'undefined' && PEQDB_Module.hexToRgb) ? PEQDB_Module.hexToRgb(accentColor) : '90, 169, 230';
                root.style.setProperty('--accent-blue-rgb', rgbStr);
                // --accent-rgb drives the window bloom in app.css. Kept in sync
                // with --accent-blue-rgb so a JS-applied theme and a
                // class-applied theme produce the same texture.
                root.style.setProperty('--accent-rgb', rgbStr);
                // Retired-token bridge: --accent-ink is near-black on every one
                // of the nine accents, so on-accent glyphs are always dark.
                root.style.setProperty('--accent-ink', '#0A0A0B');
                root.style.setProperty('--accent-glow',
                    (t.variables && t.variables['--accent-glow']) || ('rgba(' + rgbStr + ', 0.16)'));
                root.style.setProperty('--accent-soft',
                    (t.variables && t.variables['--accent-soft']) || ('rgba(' + rgbStr + ', 0.08)'));

            ['find', 'eq', 'testlab', 'iem', 'database', 'visualizer', 'settings'].forEach(id => {
                const b = document.getElementById(`tab-${id}-btn`);
                if (b) {
                    b.style.backgroundColor = '';
                    b.style.color = '';
                    b.style.borderColor = '';
                    b.style.boxShadow = '';
                    b.style.transform = '';
                }
            });
            const activeTabId = ['find', 'eq', 'testlab', 'iem', 'database', 'visualizer', 'settings'].find(id => {
                const pane = document.getElementById(`pane-${id}`);
                return pane && !pane.classList.contains('hidden');
            }) || 'find';
            const activeBtn = document.getElementById(`tab-${activeTabId}-btn`);
            if (activeBtn) {
                // Selected nav pill: an accent wash + accent border, matching the
                // .subtab-seg-btn.active / .retro-switch-btn.is-on language.
                // Was a solid accent fill with a 2px inset black bevel.
                activeBtn.style.backgroundColor = 'var(--accent-soft)';
                activeBtn.style.borderColor = 'var(--accent)';
                activeBtn.style.color = 'var(--accent-hi)';
                activeBtn.style.boxShadow = '0 0 0 1px var(--accent-glow)';
                activeBtn.style.transform = 'none';
            }

                const themeBtn = document.getElementById('theme-cycle-btn');
            if (themeBtn) {
                themeBtn.innerHTML = `<span>${t.emoji || '🎨'} ${t.name}</span>`;
            }

                if (window.IEM && IEM.radarChart) {
                IEM.radarChart.data.datasets[0].borderColor = t.accent;
                IEM.radarChart.data.datasets[0].pointBackgroundColor = t.accent;
                IEM.radarChart.data.datasets[0].backgroundColor = t.accent + '1a';
                if (IEM.radarChart.options && IEM.radarChart.options.scales && IEM.radarChart.options.scales.r) {
    IEM.radarChart.options.scales.r.pointLabels.color = t.variables ? t.variables['--text-main'] : '#1a1105';
}
                IEM.radarChart.update();
            }
            if (window.EQ) {
                EQ.drawCurve();
            }
            if (window.syncGlobalSliders) {
                window.syncGlobalSliders();
            }
            localStorage.setItem('settings_theme_id', themeId);
            // Invalidate the visualizer's cached accent so the next frame
            // re-resolves it (the draw loop no longer re-reads the theme
            // from localStorage every frame).
            if (typeof EQ_Module !== 'undefined') {
                EQ_Module._vizThemeDirty = true;
            }
            // Invalidate canvas font cache
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
            this.applyThemeTransition();
        } catch (error) {
            console.error("Theme application failed:", error);
        }
        },
        cycleFont: function() {
            if (window.App_Theme) return App_Theme.cycleFont.call(this);
            const keys = Object.keys(this.fontMap);
            if (keys.length === 0) return;
            const current = localStorage.getItem('settings_font_id') || keys[0];
            let curIdx = keys.indexOf(current);
            if (curIdx === -1) curIdx = 0;
            const nextIdx = (curIdx + 1) % keys.length;
            this.setGlobalFont(keys[nextIdx]);
        },

        currentFontScale: 1.0,
        currentReadingScale: 1.0,

        updateCombinedFontScale: function() {

            const raw = this.currentFontScale * this.currentReadingScale;
            const combined = Math.max(0.7, Math.min(1.3, raw));

            document.documentElement.style.setProperty('--font-scale-modifier', combined);
            document.documentElement.style.fontSize = (16 * combined) + 'px';
            document.documentElement.style.zoom = '1';

            if (window.EQ && EQ.drawCurve) EQ.drawCurve();
        },
        setReadingSize: function(scaleVal) {
            const val = parseFloat(scaleVal) || 1.0;
            this.currentReadingScale = val;

            const pct = Math.round(val * 100);
            const disp = document.getElementById('reading-size-display');
            if (disp) disp.textContent = pct + '%';

            this.updateCombinedFontScale();
            localStorage.setItem('settings_reading_scale', val);
        },
setGlobalFont: function(fontId) {
            if (window.App_Theme) return App_Theme.setGlobalFont.call(this, fontId);
            try {
                const fontStack = (this.fontMap && this.fontMap[fontId]) ? this.fontMap[fontId] : 'system-ui, -apple-system, sans-serif';
                if (!fontStack) return;

                document.documentElement.style.setProperty('--font-family', fontStack);
                this.isComicFont = fontId.toLowerCase().includes('comic');

                const meta = this.fontMeta.find(m => m.id === fontId) || { scale: 1.0, letterSpacing: 'normal', emoji: '🔤' };

                this.currentFontMeta = meta;
                document.documentElement.style.setProperty('--font-letter-spacing', meta.letterSpacing);

                this.currentFontScale = meta.scale;
                this.updateCombinedFontScale();

                const fontBtn = document.getElementById('font-cycle-btn');
                if (fontBtn) {
                    fontBtn.innerHTML = `<span>${meta.emoji} ${fontId}</span>`;
                }

                                if (typeof IEM_Module !== 'undefined' && IEM_Module.selectExportFont) {
                IEM_Module.selectExportFont(fontId);
            }

            if (window.Chart) {
                Chart.defaults.font.family = fontStack;
            }
            if (window.IEM && IEM.radarChart) {
                IEM.radarChart.options.scales.r.pointLabels.font.family = fontStack;
                IEM.radarChart.update();
            }
            if (window.EQ) {
                EQ.drawCurve();
            }
            localStorage.setItem('settings_font_id', fontId);
            // Invalidate canvas font cache
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
        } catch (error) {
            console.error("Font application failed:", error);
        }
        },

        applyThemeTransition: function() {
            if (window.App_Theme) return App_Theme.applyThemeTransition.call(this);
            document.body.classList.add('theme-transition');
            setTimeout(() => {
                document.body.classList.remove('theme-transition');
            }, 300);
        },

        activeReviewSection: 'specs',
        activeEqSection: 'db',
        activeFindSection: 'matches',

        setReviewSection: function(secId) {
            this.activeReviewSection = secId;
            this.updateMobileSectionLabel('iem', secId);

            ['specs', 'radar', 'sliders'].forEach(id => {
                const pill = document.getElementById('m-iem-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colSpecs = document.getElementById('iem-col-specs');
            const colRadar = document.getElementById('iem-col-radar');
            const colSliders = document.getElementById('iem-col-sliders');

            if (colSpecs && colRadar && colSliders) {
                if (window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX) {
                    colSpecs.style.display = secId === 'specs' ? 'flex' : 'none';
                    colRadar.style.display = secId === 'radar' ? 'flex' : 'none';
                    colSliders.style.display = secId === 'sliders' ? 'flex' : 'none';

                    if (secId === 'radar' && window.IEM && IEM.radarChart) {
                        setTimeout(() => {
                            IEM.radarChart.resize();
                            IEM.radarChart.update();
                        }, 50);
                    }
                } else {

                    colSpecs.style.display = '';
                    colRadar.style.display = '';
                    colSliders.style.display = '';
                }
            }
        },
                setFindSection: function(secId) {
            this.activeFindSection = secId;
            this.updateMobileSectionLabel('find', secId);
            ['prefs', 'matches', 'tools'].forEach(id => {
                const pill = document.getElementById('m-find-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });
            const colPrefs = document.getElementById('find-col-prefs');
            const colMatches = document.getElementById('find-col-results');
            const colTools = document.getElementById('find-col-tools');
            if (colPrefs && colMatches && colTools) {
                if (window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX) {
                    colPrefs.style.display = secId === 'prefs' ? 'flex' : 'none';
                    colMatches.style.display = secId === 'matches' ? 'flex' : 'none';
                    colTools.style.display = secId === 'tools' ? 'flex' : 'none';
                } else {
                    colPrefs.style.display = 'flex';
                    colMatches.style.display = 'flex';
                    colTools.style.display = 'flex';
                }
            }
        },
        setEqSection: function(secId) {
            this.activeEqSection = secId;
            this.updateMobileSectionLabel('eq', secId);

            ['db', 'graph', 'console'].forEach(id => {
                const pill = document.getElementById('m-eq-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colDb = document.getElementById('eq-col-db');
            const colGraph = document.getElementById('eq-col-graph');
            const colConsole = document.getElementById('eq-col-console');

            if (colDb && colGraph && colConsole) {
                if (window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX) {
                    colDb.style.display = secId === 'db' ? 'flex' : 'none';
                    colGraph.style.display = secId === 'graph' ? 'flex' : 'none';
                    colConsole.style.display = secId === 'console' ? 'flex' : 'none';

                    if (secId === 'graph' && window.EQ && EQ.drawCurve) {
                        setTimeout(() => {
                            EQ.drawCurve();
                        }, 50);
                    }
                } else {

                    colDb.style.display = '';
                    colGraph.style.display = '';
                    colConsole.style.display = '';
                }
            }
        },

        activeTestLabSection: 'sweeps',
        activeDatabaseSection: 'tree',

        mobileSectionConfig: {
            iem: { order: ['specs', 'radar', 'sliders'], labels: { specs: '📋 Specs', radar: '📊 Chart', sliders: '🎚️ Sliders' }, current: 'activeReviewSection', setter: 'setReviewSection' },
            find: { order: ['prefs', 'matches', 'tools'], labels: { prefs: '🎯 Tuning', matches: '🔍 Matches', tools: '🛠️ Tools' }, current: 'activeFindSection', setter: 'setFindSection' },
            eq: { order: ['db', 'graph', 'console'], labels: { db: '🎯 Targets', graph: '📈 Graph', console: '🎛️ Console' }, current: 'activeEqSection', setter: 'setEqSection' },
            database: { order: ['tree', 'editor', 'tools'], labels: { tree: '🗂️ Entries', editor: '✏️ Editor', tools: '🛠️ Tools' }, current: 'activeDatabaseSection', setter: 'setDatabaseSection' },
            testlab: { order: ['sweeps', 'spatial', 'generators'], labels: { sweeps: '📡 Signals', spatial: '🔊 Soundstage', generators: '🎵 Generators' }, current: 'activeTestLabSection', setter: 'setTestLabSection' }
        },
        cycleMobileSection: function(paneKey, direction) {
            const cfg = this.mobileSectionConfig[paneKey];
            if (!cfg) return;
            const curId = this[cfg.current] || cfg.order[0];
            let idx = cfg.order.indexOf(curId);
            idx = (idx + direction + cfg.order.length) % cfg.order.length;
            const nextId = cfg.order[idx];
            this[cfg.setter](nextId);
            this.updateMobileSectionLabel(paneKey, nextId);
        },
        updateMobileSectionLabel: function(paneKey, secId) {
            const cfg = this.mobileSectionConfig[paneKey];
            if (!cfg) return;
            const labelEl = document.getElementById(paneKey + '-mobile-section-label');
            if (labelEl) labelEl.textContent = cfg.labels[secId] || secId;
        },

        setDatabaseSection: function(secId) {
            this.activeDatabaseSection = secId;
            this.updateMobileSectionLabel('database', secId);
            const cols = { tree: 'database-col-tree', editor: 'database-col-editor', tools: 'database-col-tools' };
            const narrow = window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX;
            Object.keys(cols).forEach(k => {
                const el = document.getElementById(cols[k]);
                if (el) el.style.display = narrow ? (k === secId ? 'flex' : 'none') : '';
            });
        },

        setTestLabSection: function(secId) {
            this.activeTestLabSection = secId;
            this.updateMobileSectionLabel('testlab', secId);

            ['sweeps', 'spatial', 'generators'].forEach(id => {
                const pill = document.getElementById('m-testlab-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colSweeps = document.getElementById('testlab-col-sweeps');
            const colSpatial = document.getElementById('testlab-col-spatial');
            const colGenerators = document.getElementById('testlab-col-generators');

            if (colSweeps && colSpatial && colGenerators) {
                if (window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX) {
                    colSweeps.style.display = secId === 'sweeps' ? 'flex' : 'none';
                    colSpatial.style.display = secId === 'spatial' ? 'flex' : 'none';
                    colGenerators.style.display = secId === 'generators' ? 'flex' : 'none';
                } else {
                    colSweeps.style.display = '';
                    colSpatial.style.display = '';
                    colGenerators.style.display = '';
                }
            }
        },

        priceSpinActive: false,
        triggerPriceSlotMachine: function() {
            if (this.priceSpinActive) return;
            const input = document.getElementById('price');
            if (!input) return;

            const val = input.value.trim();

            const secretMap = {
                '9999': "Priceless 👑",
                '115': "Brains... 🧟",
                '69': "Nice... 😏",
                '808': "BASS... 🥁",
                '777': "Lucy 🍀",
                '8008': "LOL 😂",
                '800': "Boo... 👻",
                '404': "Not Found ⚠️",
                '999': "Run... 👹",
                '42': "The Answer 🌌",
                '5151': "LOCO 🤪",
                '935': "Element 115 🧪",
                '420': "Blaze It 🌿",
                '100': "Keep It 💯",
                '101': "Knowledge 🔓"
            };

            if (!secretMap.hasOwnProperty(val)) {

                const label = document.getElementById('price-label');
                if (label) {
                    label.classList.add('text-amber-500');
                    setTimeout(() => label.classList.remove('text-amber-500'), 400);
                }
                return;
            }

            this.priceSpinActive = true;
            let elapsed = 0;
            const finalWord = secretMap[val];

            const ctx = SharedAudio.init();
            if (ctx) ctx.resume();

            const spinInterval = setInterval(() => {
                elapsed += 50;

                let scramble = "";
                const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$@!%&";
                for (let i = 0; i < finalWord.length; i++) {
                    scramble += glyphs[Math.floor(Math.random() * glyphs.length)];
                }
                input.value = scramble;

                try {
                    if (ctx) {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(1000 + Math.random() * 600, ctx.currentTime);
                        gain.gain.setValueAtTime(0.015, ctx.currentTime);
                        osc.connect(gain).connect(ctx.destination);
                        osc.start();
                        osc.stop(ctx.currentTime + 0.02);
                    }
                } catch(e) {}

                if (elapsed >= 1500) {
                    clearInterval(spinInterval);
                    input.value = finalWord;
                    this.priceSpinActive = false;

                    try {
                        if (ctx) {
                            const now = ctx.currentTime;

                            const osc1 = ctx.createOscillator();
                            const gain1 = ctx.createGain();
                            osc1.type = 'square';
                            osc1.frequency.setValueAtTime(987.77, now);
                            gain1.gain.setValueAtTime(0, now);
                            gain1.gain.linearRampToValueAtTime(0.03, now + 0.005);
                            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                            osc1.connect(gain1).connect(ctx.destination);
                            osc1.start(now);
                            osc1.stop(now + 0.08);

                            const osc2 = ctx.createOscillator();
                            const gain2 = ctx.createGain();
                            osc2.type = 'square';
                            osc2.frequency.setValueAtTime(1318.51, now + 0.08);
                            gain2.gain.setValueAtTime(0, now + 0.08);
                            gain2.gain.linearRampToValueAtTime(0.03, now + 0.085);
                            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                            osc2.connect(gain2).connect(ctx.destination);
                            osc2.start(now + 0.08);
                            osc2.stop(now + 0.35);
                        }
                    } catch(e) {}

                    showToast(`Secret Unlocked: ${finalWord}! 🎰`, "🪙");
                }
            }, 50);
        },

        tbSequence: [],
        tbClick: function(step) {
            this.tbSequence.push(step);
            if (this.tbSequence.length > 3) this.tbSequence.shift();

            if (this.tbSequence.join('-') === '1-2-3') {
                this.tbSequence = [];
                this.triggerTeddyBearMelody();
            }
        },
        triggerTeddyBearMelody: function() {
                        try {
                            const ctx = SharedAudio.init();
                            if (ctx) {
                                ctx.resume();
                                const now = ctx.currentTime;

                                const notes = [146.83, 155.56, 146.83, 110.00];
                                notes.forEach((freq, idx) => {
                                    const osc = ctx.createOscillator();
                                    const gain = ctx.createGain();

                                    osc.type = 'sawtooth';

                                    const filter = ctx.createBiquadFilter();
                                    filter.type = 'lowpass';
                                    filter.frequency.value = 400;

                                    osc.frequency.setValueAtTime(freq, now + idx * 0.45);

                                    gain.gain.setValueAtTime(0, now + idx * 0.45);
                                    gain.gain.linearRampToValueAtTime(0.06, now + idx * 0.45 + 0.05);
                                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.45 + 0.45);

                                    osc.connect(filter).connect(gain).connect(ctx.destination);
                                    osc.start(now + idx * 0.45);
                                    osc.stop(now + idx * 0.45 + 0.45);
                                });
                            }
                        } catch(e) {}
                        showToast("Spooky Vibes Unlocked.", "👻");
                    },

        rippleEffect: function(event, button) {
            try {
                if (!button) return;
                // Never reposition fixed/absolute elements: forcing
                // position:relative here once DEMOTED every fixed-position
                // button (e.g. the ? shortcuts FAB, fixed bottom-right) to
                // relative, teleporting it into body flow, clipped off the
                // left-bottom edge — visually "the FAB moved to the left
                // corner after clicking it". Overlay buttons get no ripple
                // (their positioning IS the layout; a decorative span inside
                // a 32px round FAB added nothing anyway).
                const pos = window.getComputedStyle(button).position;
                if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') return;
                button.style.position = 'relative';

                const circle = document.createElement('span');
                const diameter = Math.max(button.clientWidth, button.clientHeight);
                const radius = diameter / 2;

                circle.style.width = circle.style.height = `${diameter}px`;

                const rect = button.getBoundingClientRect();
                circle.style.left = `${event.clientX - rect.left - radius}px`;
                circle.style.top = `${event.clientY - rect.top - radius}px`;
                circle.style.position = 'absolute';
                circle.style.pointerEvents = 'none';
                circle.classList.add('ripple');

                const existing = button.getElementsByClassName('ripple')[0];
                if (existing) {
                    existing.remove();
                }

                button.appendChild(circle);

                setTimeout(() => {
                    circle.remove();
                }, 500);
            } catch (error) {
                console.error("Ripple animation failed:", error);
            }
        },

                triggerMushroomEgg: function(el) {
            if (el.classList.contains('mushroom-pop-active')) return;

            window.mushroomSporesActive = !window.mushroomSporesActive;

            el.classList.add('mushroom-pop-active');
            setTimeout(() => {
                el.classList.remove('mushroom-pop-active');
                if (window.mushroomSporesActive) {
                    el.classList.add('mushroom-enabled');
                } else {
                    el.classList.remove('mushroom-enabled');
                }
            }, 500);

            const listenerIcon = document.getElementById('spatial-listener-icon');
            if (listenerIcon) {
                listenerIcon.textContent = window.mushroomSporesActive ? "🍄" : "🎧";
            }

            if (window.mushroomHueInterval) {
                clearInterval(window.mushroomHueInterval);
                window.mushroomHueInterval = null;
            }
            if (window.mushroomSporesActive) {
                Mascot.triggerTemporaryExpression('imbalance', 3000);
                var mascotEl = document.getElementById('brand-icon-emoji');
                if (mascotEl) {
                    mascotEl.style.filter = 'hue-rotate(0deg)';
                    window.mushroomHueInterval = setInterval(function() {
                        if (!window.mushroomSporesActive) {
                            clearInterval(window.mushroomHueInterval);
                            window.mushroomHueInterval = null;
                            mascotEl.style.filter = '';
                            return;
                        }
                        var hue = (Date.now() / 20) % 360;
                        mascotEl.style.filter = 'hue-rotate(' + hue + 'deg) brightness(1.3)';
                    }, 50);
                }
            } else {
                var mascotEl = document.getElementById('brand-icon-emoji');
                if (mascotEl) {
                    mascotEl.style.filter = '';
                }
            }

            try {
                const ctx = SharedAudio.init();
                if (ctx) {
                    ctx.resume();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(220, ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1440, ctx.currentTime + 0.45);
                    gain.gain.setValueAtTime(0.06, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.45);
                }
            } catch(e) {}

            if (window.mushroomSporesActive) {
                showToast("Spores Activated!", "✔️");
                this.runGlobalSporesLoop();
            } else {
                showToast("Spores Deactivated.", "❌");
            }
        },

        runGlobalSporesLoop: function() {

            if (this._sporesLoopStarted) return;
            this._sporesLoopStarted = true;

            const canvas = document.getElementById('global-spores-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            const resizeCanvas = () => {
                if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                }
            };
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            const particles = [];
            const maxParticles = 65;

            const createParticle = () => {
                return {
                    x: Math.random() * canvas.width,
                    y: canvas.height + Math.random() * 80,
                    size: Math.random() * 2.5 + 0.8,
                    speedY: Math.random() * -0.7 - 0.3,
                    wobble: Math.random() * Math.PI,
                    wobbleSpeed: Math.random() * 0.02 + 0.01,
                    alpha: Math.random() * 0.4 + 0.3
                };
            };

            const draw = () => {
                if (!window.mushroomSporesActive) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    canvas.style.display = 'none';
                    // The loop is dead but the started flag stays true, so a
                    // second activation hit the guard above and never
                    // re-scheduled draw() — the spores stayed off forever
                    // after the first deactivate. Reset the flag here so
                    // runGlobalSporesLoop can restart cleanly.
                    this._sporesLoopStarted = false;
                    // Also drop the resize listener added above; otherwise
                    // every on/off cycle leaked one listener holding a stale
                    // canvas reference.
                    window.removeEventListener('resize', resizeCanvas);
                    return;
                }

                canvas.style.display = 'block';
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                const activeThemeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                const themeAccent = activeThemeConfig.accent || "#787878";

                while (particles.length < maxParticles) {
                    particles.push(createParticle());
                }

                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    p.y += p.speedY;
                    p.wobble += p.wobbleSpeed;
                    const px = p.x + Math.sin(p.wobble) * 20;

                    ctx.save();
                    ctx.fillStyle = themeAccent;
                    ctx.globalAlpha = p.alpha;
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = themeAccent;
                    ctx.beginPath();
                    ctx.arc(px, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();

                    if (p.y < -10) {
                        p.y = canvas.height + 10;
                        p.x = Math.random() * canvas.width;
                        p.speedY = Math.random() * -0.7 - 0.3;
                        p.alpha = 0.3 + Math.random() * 0.7;
                        p.size = Math.random() * 2.5 + 0.8;
                        p.wobble = Math.random() * Math.PI * 2;
                    }
                }

                requestAnimationFrame(draw);
            };
            draw();
        },
        resetAllInputsOnLoad: function() {
            try {
                if (window.PEQDB && PEQDB.STATE) {
                    PEQDB.STATE.activeCurves = [];
                    PEQDB.targetMode = '';
                }

                document.querySelectorAll('input:not([type="file"]):not([type="range"]):not([type="checkbox"]), select, textarea').forEach(el => {
                    el.value = el.defaultValue || '';
                });

                document.querySelectorAll('input[type="range"]').forEach(el => {
                    const defaultVal = el.getAttribute('value');
                    if (defaultVal !== null) {
                        el.value = defaultVal;
                    } else {
                        const min = parseFloat(el.min || 0);
                        const max = parseFloat(el.max || 100);
                        el.value = (min + max) / 2;
                    }
                });

                document.querySelectorAll('input[type="checkbox"]').forEach(el => {
                    el.checked = el.defaultChecked || false;
                });
            } catch (error) {
                console.error("Autofill reset failed:", error);
            }
        },
        initGlobalSliders: function() {
            try {
                // Skip identical background rewrites: the playback rAF ticker and
                // drag input events otherwise rebuild + reassign the same gradient
                // string hundreds of times per second, forcing needless style
                // recalcs that show up as drag jank.
                const trackFillCache = new WeakMap();
                const setTrackBg = (el, bg) => {
                    if (trackFillCache.get(el) === bg) return;
                    trackFillCache.set(el, bg);
                    el.style.background = bg;
                };
                const updateTrack = (el) => {
                    const val = parseFloat(el.value);
                    const min = parseFloat(el.min || 0);
                    const max = parseFloat(el.max || 100);

                    if (el.classList.contains('dual-range')) return;

                    if (el.classList.contains('iem-slider') && min === -10 && max === 10) {
                        if (val >= 0) {
                            const activePercent = (val / 10) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff 50%, var(--accent-blue) 50%, var(--accent-blue) ${50 + activePercent}%, #ffffff ${50 + activePercent}%, #ffffff 100%)`);
                        } else {
                            const activePercent = (Math.abs(val) / 10) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff ${50 - activePercent}%, var(--accent-red) ${50 - activePercent}%, var(--accent-red) 50%, #ffffff 50%, #ffffff 100%)`);
                        }
                    } else if (el.classList.contains('eq-slider-vertical')) {
                        if (val >= 0) {
                            const activePercent = (val / 12) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff 50%, var(--accent-blue) 50%, var(--accent-blue) ${50 + activePercent}%, #ffffff ${50 + activePercent}%, #ffffff 100%)`);
                        } else {
                            const activePercent = (Math.abs(val) / 12) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff ${50 - activePercent}%, var(--accent-red) ${50 - activePercent}%, var(--accent-red) 50%, #ffffff 50%, #ffffff 100%)`);
                        }
                    } else {
                        const percent = ((val - min) / (max - min)) * 100;
                        setTrackBg(el, `linear-gradient(90deg, var(--accent-blue) ${percent}%, #ffffff ${percent}%)`);
                    }
                };

                // Shared painter for high-frequency callers (scrub timeupdate /
                // drag input) so they restyle ONE element instead of running a
                // full-page syncGlobalSliders pass on every mousemove frame.
                // updateTrack paints an inline background that the stylesheet's
                // !important track rule overrides, so also refresh the variable the
                // stylesheet DOES read (see app-init.js).
                window.paintSliderTrack = function (el) {
                    updateTrack(el);
                    if (window.IEM_updateRangeFill && el && el.type === 'range') window.IEM_updateRangeFill(el);
                };

                const applyMagneticSnapping = (input) => {
                    let val = parseFloat(input.value);
                    const id = input.id;

                    if (id.startsWith('eq-s') || id.startsWith('eq-a') || id === 'eq-preampSlider' || id === 'comp-gain-slider') {
                        const threshold = 0.45;
                        let snapThreshold = threshold;
                        if (id === 'comp-gain-slider') snapThreshold = 3.0;

                        if (Math.abs(val) <= snapThreshold) {
                            input.value = "0.0";
                        }
                    }

                    if (id.startsWith('eq-q_')) {
                        if (Math.abs(val - 1.0) <= 0.12) {
                            input.value = "1.0";
                        }
                    }

                    if (id === 'a11y-balance-slider') {
                        if (Math.abs(val) <= 12.0) {
                            input.value = "0";
                        }
                    }

                    if (id === 'ab-crossfade') {
                        if (Math.abs(val - 0.5) <= 0.05) {
                            input.value = "0.5";
                        }
                    }

                    if (id === 'eq-musicVolumeSlider' || id === 'modal-volume-slider') {
                        if (Math.abs(val - 50) <= 5.0) {
                            input.value = "50";
                        }
                    }
                };

                document.querySelectorAll('input[type="range"]').forEach(input => {
                    updateTrack(input);

                    input.addEventListener('input', () => {
                        applyMagneticSnapping(input);
                        updateTrack(input);
                    });

                    input.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const step = parseFloat(input.step) || 1.0;
                        const direction = e.deltaY < 0 ? 1 : -1;
                        let val = parseFloat(input.value) || 0;

                        let newVal = val + (direction * step);
                        const min = parseFloat(input.min !== "" ? input.min : 0);
                        const max = parseFloat(input.max !== "" ? input.max : 100);
                        newVal = Math.max(min, Math.min(max, newVal));

                        input.value = newVal;
                        applyMagneticSnapping(input);
                        updateTrack(input);

                        input.dispatchEvent(new Event('input'));
                        input.dispatchEvent(new Event('change'));
                    }, { passive: false });
                });

                // Accepts an optional element. Five call sites pass one
                // (eq-playlist.js after track swaps, accessibility.js on every
                // balance-slider input, eq-loudness.js on every strength input)
                // believing it is a scoped single-slider repaint. This used to
                // ignore the argument and repaint ALL ~111 range inputs in the
                // document every time — roughly 26,000 style writes/second while
                // dragging the balance or loudness slider. The `paintSliderTrack`
                // escape hatch above already existed for exactly this reason but
                // was only used in 2 places.
                window.syncGlobalSliders = (el) => {
                    if (el && el.tagName === 'INPUT' && el.type === 'range') {
                        el.lastDragVal = parseFloat(el.value) || 0;
                        updateTrack(el);
                        if (window.IEM_updateRangeFill) window.IEM_updateRangeFill(el);
                        return;
                    }
                    document.querySelectorAll('input[type="range"]').forEach(input => {
                        input.lastDragVal = parseFloat(input.value) || 0;
                        updateTrack(input);
                        if (window.IEM_updateRangeFill) window.IEM_updateRangeFill(input);
                    });
                };
            } catch (error) {
                console.error("Slider initialization failed:", error);
            }
        },
        initDragAndDrop: function() {
            const preventDefaults = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            /* Arming toggles the documented `.is-armed` state class instead of
               writing inline colours. The drop outline is declared
               `border: var(--drop-outline) !important` (app.css 8.9), and an
               inline `style.borderColor = ...` carries no priority, so it loses
               to that shorthand - the drag highlight silently stopped appearing
               the moment these zones were given the shared treatment. A state
               class is also what lets the outline go SOLID while armed, which
               the old inline hack could not do. */
            const addDragStyles = (el) => {
                el.classList.add('is-armed');
            };

            const removeDragStyles = (el) => {
                el.classList.remove('is-armed');
            };

            const dockLabel = document.getElementById('eq-file-label');
            const eqFileInput = document.getElementById('eq-file');
            if (dockLabel && eqFileInput) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, () => dockLabel.style.transform = 'scale(1.15)', false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, () => dockLabel.style.transform = '', false);
                });
                dockLabel.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        eqFileInput.files = files;
                        eqFileInput.dispatchEvent(new Event('change'));
                    }
                }, false);
            }

            const zoneA = document.getElementById('ab-drop-zone-a');
            const fileA = document.getElementById('ab-file-a');
            const labelA = document.getElementById('ab-file-label-a');
            if (zoneA && fileA) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    zoneA.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    zoneA.addEventListener(evtName, () => {
                        addDragStyles(zoneA);
                        if (labelA) labelA.style.transform = 'scale(1.15)';
                    }, false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    zoneA.addEventListener(evtName, () => {
                        removeDragStyles(zoneA);
                        if (labelA) labelA.style.transform = '';
                    }, false);
                });
                zoneA.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        fileA.files = files;
                        fileA.dispatchEvent(new Event('change'));
                    }
                }, false);
            }

            const zoneB = document.getElementById('ab-drop-zone-b');
            const fileB = document.getElementById('ab-file-b');
            const labelB = document.getElementById('ab-file-label-b');
            if (zoneB && fileB) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    zoneB.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    zoneB.addEventListener(evtName, () => {
                        addDragStyles(zoneB);
                        if (labelB) labelB.style.transform = 'scale(1.15)';
                    }, false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    zoneB.addEventListener(evtName, () => {
                        removeDragStyles(zoneB);
                        if (labelB) labelB.style.transform = '';
                    }, false);
                });
                zoneB.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        fileB.files = files;
                        fileB.dispatchEvent(new Event('change'));
                    }
                }, false);
            }
        },
        restoreSavedSettings: function() {
            if (this.settingsRestored) return;
            this.settingsRestored = true;

            try {
                const savedTheme = localStorage.getItem('settings_theme_id') || 'slate';
                this.setGlobalTheme(this.themeMap[savedTheme] ? savedTheme : 'slate');

const savedFont = localStorage.getItem('settings_font_id') || 'JetBrains Mono';
        this.setGlobalFont(this.fontMap[savedFont] ? savedFont : 'JetBrains Mono');

                const savedScale = localStorage.getItem('settings_reading_scale') || '1.00';
                const sizeSlider = document.getElementById('reading-size-slider');
                if (sizeSlider) sizeSlider.value = savedScale;
                this.setReadingSize(savedScale);

            } catch(e) {
                console.error("Autosave load failed:", e);
            }

            try {
                const savedAlignHz = localStorage.getItem('settings_align_hz');
                const savedAlignDb = localStorage.getItem('settings_align_db');
                if (savedAlignHz !== null && window.PEQDB) {
                    PEQDB.setAlignHz(savedAlignHz);
                }
                if (savedAlignDb !== null && window.PEQDB) {
                    PEQDB.setAlignDb(parseFloat(savedAlignDb));
                }
            } catch (error) {
                console.error("Settings alignment load failed:", error);
            }

            // Restore the saved hearing correction layer (if any) — after the
            // DSP graph paths exist so applyHearingCalibrationGains reaches
            // the worklet (it also self-queues via the pending-DSP path).
            try {
                if (typeof this.restoreHearingCorrection === 'function') {
                    this.restoreHearingCorrection();
                }
            } catch (err) {
                console.error("Hearing correction restore failed:", err);
            }
        },
        init: function() {
            try {
                // Exposed so the data-cmd dispatcher in events.js can reach these
                // by name. FindEngine was previously unreachable this way, which
                // is why the Find tab's runtime-built controls were still stuck
                // with inline onclick attributes.
                window.App = App; window.IEM = IEM_Module; window.EQ = EQ_Module; window.Tone = Tone_Module; window.TestLab = TestLab_Module; window.PEQDB = PEQDB_Module;
                if (typeof FindEngine !== 'undefined') window.FindEngine = FindEngine;

                // R1: bind the custom caption bar (minimise / maximize / close)
                // and subscribe it to real window state. No-ops when the page is
                // loaded outside Electron, e.g. by the tools/ screenshot harness.
                if (window.UIKit && typeof UIKit.windowChrome === 'function') {
                    UIKit.windowChrome();
                }

                // R3: Settings renders Track transitions and Blue light as real
                // controls whose state is derived from localStorage rather than
                // hard-coded in the markup. Applying the state once at boot makes
                // localStorage the single source of truth, instead of the control
                // staying lit until the user clicked it.
                try {
                    if (window.EQ) {
                        if (EQ._applyTrackTransition) EQ._applyTrackTransition();
                        // R4: same principle for the visualiser's effect
                        // button — derive the label from vizModeIndex on boot
                        // instead of leaving a hard-coded string in the markup.
                        if (EQ._updateVizEffectLabel) EQ._updateVizEffectLabel();
                    }
                } catch (e) {
                    console.warn('[Settings] switch state init skipped:', e);
                }

                ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel'].forEach(evt => {
                    window.addEventListener(evt, () => {
                        if (typeof Mascot !== 'undefined' && Mascot.handleUserActivity) {
                            Mascot.handleUserActivity();
                        }
                    }, { passive: true });
                });

                document.addEventListener('touchstart', function() {
                    // Same dead `window.SharedAudio` guard as above: the first
                    // touch never resumed a suspended context on touch devices.
                    if (typeof SharedAudio !== 'undefined' && SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume().catch(()=>{});
                    }
                }, { once: true, passive: true });

                // Mascot's idle animation tick. `window.Mascot` was always
                // undefined (Mascot is a top-level `var`/`const`, never a window
                // property), so this interval woke up once a second for the whole
                // session and did nothing at all.
                setInterval(() => {
                    if (document.visibilityState !== 'visible') return;
                    if (typeof Mascot !== 'undefined' && typeof EQ_Module !== 'undefined' && !EQ_Module.vizLoopRunning) {
                        Mascot.update();
                    }
                }, 1000);

                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        document.body.style.setProperty('--animation-speed-fast', '0s');
                        document.body.style.setProperty('--animation-speed-normal', '0s');
                    } else {
                        document.body.style.setProperty('--animation-speed-fast', '0.15s');
                        document.body.style.setProperty('--animation-speed-normal', '0.3s');
                    }
                });

                this.resetAllInputsOnLoad();
                this.initAudioOutputs();
                this.initUpdateCenter();

                this.renderThemeToggles();
                this.switchTab('find');
                if (typeof DataTab !== 'undefined') DataTab.init();
                this.initGlobalSliders();
                this.initDragAndDrop();

                document.addEventListener('click', (e) => {
                    const btn = e.target.closest('.btn-playback-reactive, .category-pill, button, .tag, label.btn-label');
                    if (btn) {
                        App.rippleEffect(e, btn);
                    }

                    if (window.EQ && !EQ.graphBuilt) {
                        EQ.ensureDSPGraph().catch(err => console.log("DSP boot delayed: ", err));
                    } else if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume();
                    }
                });

                const brandMushroom = document.querySelector('.sidebar-label span');
                if (brandMushroom) {
                    brandMushroom.className = "cursor-pointer inline-block ml-1 hover:brightness-125 select-none transition-all duration-300 px-1";
                    brandMushroom.addEventListener('mouseenter', () => {
                        brandMushroom.style.textShadow = '0 0 10px var(--accent-blue)';
                        brandMushroom.style.transform = 'scale(1.1)';
                    });
                    brandMushroom.addEventListener('mouseleave', () => {
                        brandMushroom.style.textShadow = 'none';
                        brandMushroom.style.transform = 'none';
                    });
                }

                let resizeTimeout;
                window.addEventListener('resize', () => {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(() => {
                        if (window.EQ && EQ.drawCurve) {
                            EQ.drawCurve();
                        }
                        if (window.IEM && IEM.renderImagePreview) {
                            IEM.renderImagePreview();
                        }
                    }, 150);
                });

                window.addEventListener('dragover', (e) => {
                    e.preventDefault();
                });
                window.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file && file.name.toLowerCase().endsWith('.json')) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            try {
                                let rawText = reader.result;
                                rawText = rawText.replace(/^\uFEFF/, '').trim();

                                const data = JSON.parse(rawText);
                                if (data && typeof data === 'object') {
                                    // Route through the shared importer so a
                                    // dropped full_workstation_backup actually
                                    // restores its workspace+library — the old
                                    // direct loadProfileData call blanked the
                                    // workspace (all backup fields undefined)
                                    // while reporting success.
                                    IEM_Module._importParsedConfig(data);
                                } else {
                                    showToast("Invalid JSON profile structure.", "⚠️");
                                }
                            } catch (err) {
                                console.error("Drop import parsing crash:", err);
                                showToast("Failed to parse imported file.", "⚠️");
                            }
                        };
                        reader.readAsText(file);
                    }
                });
            } catch (error) {
                console.error("Application boot failed:", error);
            }
        }
    };

    App._defaultThemeEntry = function() {
        const g = this.builtInThemes.find(t => t.id === 'slate');
        return g ? { name: g.name, emoji: g.emoji, accent: g.variables['--accent-blue'], variables: g.variables } : null;
    };
    App.builtInThemes.forEach(theme => {
        App.themeMap[theme.id] = {
            name: theme.name,
            emoji: theme.emoji,
            variables: theme.variables,
            accent: theme.variables['--accent-blue']
        };
    });

    (function applySavedThemeImmediately() {
        try {
            const savedId = localStorage.getItem('settings_theme_id') || 'slate';
            const theme = App.builtInThemes.find(t => t.id === savedId);
            if (theme) {
                document.documentElement.className = 'theme-' + savedId;
                Object.entries(theme.variables).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
            }
        } catch (e) {  }
    })();

    const IEM_Module = {
    // Width below which the workspace shows ONE section at a time instead of three
    // columns. Previously hard-coded as window.innerWidth < 1280 in four
    // places; on a 1366x768 display main.js opens the window at ~1229 CSS px,
    // which is under 1280, so laptops were getting the phone layout and two of
    // three columns were display:none. Must stay in step with the matching
    // breakpoint in app.css (section 8.18).
        radarChart: null, selectedTags: new Set(), selectedGenres: new Set(), selectedBass: new Set(), currentImage: null, sliderNodes: [],
        selectedDriverTypes: {},
        // (dead duplicate `exportGrade: null` removed — live default is
        // `exportGrade: 'A'` further down, next to exportColor)
        sensUnit: 'mW',
        activeLeftTab: 'search',
        activeRightTab: 'sound',

        leftTabModes: [
            { id: 'search', label: 'Search', emoji: '🔍' },
            { id: 'info', label: 'Info', emoji: '📝' },
            { id: 'drivers', label: 'Drivers', emoji: '⚙️' },
            { id: 'power', label: 'Power', emoji: '🔌' }
        ],
        cycleLeftTab: function(dir) {
            const currentIdx = this.leftTabModes.findIndex(m => m.id === this.activeLeftTab);
            const total = this.leftTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchLeftTab(this.leftTabModes[nextIdx].id);
        },
        switchLeftTab: function(tabId) {
            this.activeLeftTab = tabId;
            ['search', 'info', 'drivers', 'power'].forEach(id => {
                const panel = document.getElementById('iem-left-panel-' + id);
                const btn = document.getElementById('iem-left-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) {
                        btn.classList.add('active');
                        btn.setAttribute('aria-selected', 'true');
                    } else {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-selected', 'false');
                    }
                }
            });
            // The ◀/▶ stepper label is gone (R6 replaced it with a 4-up segmented
            // row). The lookup is removed rather than left behind: a stale
            // getElementById for a deleted id would push the dead-ref ratchet
            // over its baseline and fail the integrity gate.
        },

        rightTabModes: [
            { id: 'sound', label: 'Sound', emoji: '🎚️' },
            { id: 'photo', label: 'Photo', emoji: '📷' },
            { id: 'impressions', label: 'Notes', emoji: '📝' }
        ],
        cycleRightTab: function(dir) {
            const currentIdx = this.rightTabModes.findIndex(m => m.id === this.activeRightTab);
            const total = this.rightTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchRightTab(this.rightTabModes[nextIdx].id);
        },
        switchRightTab: function(tabId) {
            this.activeRightTab = tabId;
            ['sound', 'photo', 'impressions'].forEach(id => {
                const panel = document.getElementById('iem-right-panel-' + id);
                const btn = document.getElementById('iem-right-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) {
                        btn.classList.add('active');
                        btn.setAttribute('aria-selected', 'true');
                    } else {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-selected', 'false');
                    }
                }
            });

            // Stepper label removed in R6; see the note in switchLeftTab.

            if (tabId === 'photo' && this.renderImagePreview) {
                setTimeout(() => this.renderImagePreview(), 50);
            }
            if (tabId === 'impressions') {
                this.renderReviewSelectedTags();
            }
        },

        toggleSensUnit: function() {
            // Convert the numeric value so the PHYSICAL sensitivity is
            // preserved: dB/V = dB/mW + 10*log10(1000/R). Without this the
            // same number under a new reference silently shifts power ~30x.
            const sensEl = document.getElementById('sensitivity');
            const impEl = document.getElementById('impedance');
            const rawSens = sensEl ? parseFloat(sensEl.value) : NaN;
            const rawImp = impEl ? parseFloat(impEl.value) : NaN;
            const imp = Number.isFinite(rawImp) && rawImp > 0 ? rawImp : 32;
            const toV = this.sensUnit === 'mW';
            this.sensUnit = toV ? 'V' : 'mW';
            if (sensEl && Number.isFinite(rawSens)) {
                const delta = 10 * Math.log10(1000 / imp);
                const converted = toV ? rawSens + delta : rawSens - delta;
                // Clamp to the UI range [55,150] (see handleGaugeSlider) —
                // wide enough that the dB/V <-> dB/mW round trip is lossless
                // for every representable impedance/sensitivity pair.
                const clamped = Math.max(55, Math.min(150, converted));
                sensEl.value = clamped.toFixed(0);
                const slider = document.getElementById('sensitivity-slider');
                if (slider) slider.value = clamped;
            }
            this.updateSensUnitUI();
            this.updateAll();
        },
        updateSensUnitUI: function() {
            const toggleBtn = document.getElementById('sens-unit-toggle');
            if (toggleBtn) {
                if (this.sensUnit === 'V') {
                    toggleBtn.textContent = '(dB/V)';
                    toggleBtn.style.color = '#d946ef';
                    toggleBtn.style.textShadow = '0 0 8px rgba(217, 70, 239, 0.6)';
                } else {
                    toggleBtn.textContent = '(dB/mW)';
                    toggleBtn.style.color = '#06b6d4';
                    toggleBtn.style.textShadow = '0 0 8px rgba(6, 182, 212, 0.6)';
                }
            }
        },




        cycleListeningVolume: function() {
            const list = ['moderate', 'low', 'high', 'variable'];
            const curVal = document.getElementById('listening-volume').value || 'moderate';
            let curIdx = list.indexOf(curVal);
            if (curIdx === -1) curIdx = 0;
            const nextIdx = (curIdx + 1) % list.length;
            this.setListeningVolume(list[nextIdx]);
        },
        setListeningVolume: function(val) {
            const input = document.getElementById('listening-volume');
            if (input) input.value = val;

            const btn = document.getElementById('listening-volume-btn');
            if (btn) {
                const labelMap = { moderate: 'Normal', low: 'Quiet', high: 'Loud', variable: 'Variable' };
                btn.textContent = labelMap[val] || 'Normal';
            }
            this.updateAll();
        },
        // SPL target (dB) used by every power requirement calculation. The
        // listening-volume selector previously changed NOTHING — all three
        // power-math sites hardcoded 115 dB. 'variable' keeps 115 (the
        // historical default) since the user hasn't declared a level.
        // Single source of truth: iem-module live math, the Review card
        // export, and FindEngine's driveability badge all read this.
        LISTENING_SPL_TARGETS: { low: 105, moderate: 115, high: 120, variable: 115 },
        getListeningSplTarget: function() {
            const input = document.getElementById('listening-volume');
            const v = input ? input.value : 'moderate';
            return this.LISTENING_SPL_TARGETS[v] !== undefined ? this.LISTENING_SPL_TARGETS[v] : 115;
        },
        formFactorOptions: ['IEM', 'Earbuds (Wired)', 'Wireless Earbuds (TWS)', 'Over-Ear Headphones (Wired)', 'Wireless Over-Ear Headphones'],
        connectorOptions: ['2-pin', 'MMCX', 'QDC', 'A2DC', 'Fixed Cable', 'Detachable Cable', 'Bluetooth', 'Electrostatic'],
        cycleFormFactor: function(dir) {
            this.formFactor = this.formFactor || 'IEM';
            let idx = this.formFactorOptions.indexOf(this.formFactor);
            if (idx === -1) idx = 0;
            idx = (idx + dir + this.formFactorOptions.length) % this.formFactorOptions.length;
            this.setFormFactor(this.formFactorOptions[idx]);
        },
        cycleConnector: function(dir) {
            this.connector = this.connector || '2-pin';
            let idx = this.connectorOptions.indexOf(this.connector);
            if (idx === -1) idx = 0;
            idx = (idx + dir + this.connectorOptions.length) % this.connectorOptions.length;
            this.setConnector(this.connectorOptions[idx]);
        },
        setFormFactor: function(val) {
            this.formFactor = val;
            const hidden = document.getElementById('iem-formfactor');
            if (hidden) hidden.value = val || '';
            const label = document.getElementById('iem-formfactor-label');
            if (label) {
                const shortNames = {
                    'IEM': 'IEM',
                    'Earbuds (Wired)': 'EARBUDS',
                    'Wireless Earbuds (TWS)': 'TWS',
                    'Over-Ear Headphones (Wired)': 'HEADPHONES',
                    'Wireless Over-Ear Headphones': 'WIRELESS HEADPHONES'
                };
                const show = shortNames[val] || val || 'IEM';
                const emoji = (FindEngine && FindEngine.formFactorEmojis[val]) ? FindEngine.formFactorEmojis[val] : '<img src="app/icons/iem.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">';
                label.innerHTML = `<span class="flex items-center justify-center gap-2 truncate" title="${esc(val || '')}">${emoji}<span class="truncate type-xs tracking-wide">${esc(show)}</span></span>`;
            }
        },
        setConnector: function(val) {
            this.connector = val;
            const hidden = document.getElementById('iem-connector');
            if (hidden) hidden.value = val || '';
            const label = document.getElementById('iem-connector-label');
            if (label) {
                const emoji = (FindEngine && FindEngine.connectorEmojis[val]) ? FindEngine.connectorEmojis[val] : (val ? '🔌' : '❓');
                label.innerHTML = `<span class="flex items-center justify-center gap-1.5 truncate">${emoji}<span class="truncate">${esc(val || 'Unknown')}</span></span>`;
            }
        },
        crossoverOverride: false,
        wayOverride: false,
        currentCrossover: 'UNK',
        currentWay: 'UNK',
        currentDriverType: 'DD',
        crossoverOptions: ['UNK', 'NONE', 'PASS', 'ACOU', 'ACTV', 'HYBR'],
        wayOptions: ['UNK', '1W', '2W', '3W', '4W', '5W', '6W+'],
        cycleCrossover: function() {
            this.crossoverOverride = true;
            // indexOf is -1 for a legacy/unknown current value; normalise to a
            // known start index so the cycle advances from a defined position.
            let curIdx = this.crossoverOptions.indexOf(this.currentCrossover);
            if (curIdx === -1) curIdx = 0;
            const nextIdx = (curIdx + 1) % this.crossoverOptions.length;
            this.currentCrossover = this.crossoverOptions[nextIdx];
            this.updateCrossoverButtonsUI();
            this.updateDriverSummary();
        },
        cycleWay: function() {
            this.wayOverride = true;
            let curIdx = this.wayOptions.indexOf(this.currentWay);
            if (curIdx === -1) curIdx = 0;
            const nextIdx = (curIdx + 1) % this.wayOptions.length;
            this.currentWay = this.wayOptions[nextIdx];
            this.updateWayButtonsUI();
            this.updateDriverSummary();
        },
        updateCrossoverButtonsUI: function() {
            const btn = document.getElementById('crossover-cycle-btn');
            if (!btn) return;
            const labels = {
                UNK: '🔀 Unknown',
                NONE: '🚫 None',
                PASS: '🔌 Passive',
                ACOU: '🌬️ Acoustic',
                ACTV: '⚡ DSP',
                HYBR: '🔀 Hybrid'
            };
            btn.textContent = labels[this.currentCrossover] || '🔀 Crossover: Unknown';
            if (this.currentCrossover === 'UNK') {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border border-[var(--border-color)] type-micro font-bold text-zinc-400 transition-all flex items-center justify-center gap-1 cursor-pointer";
            } else {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border-[var(--accent-blue)] type-micro font-bold text-[var(--accent-blue)] transition-all flex items-center justify-center gap-1 cursor-pointer";
            }
        },
        updateWayButtonsUI: function() {
            const btn = document.getElementById('way-cycle-btn');
            if (!btn) return;
            const labels = {
                UNK: '🧩 Unknown',
                '1W': '1️⃣  1-Way',
                '2W': '2️⃣  2-Way',
                '3W': '3️⃣  3-Way',
                '4W': '4️⃣  4-Way',
                '5W': '5️⃣  5-Way',
                '6W+': '🔟 6-Way+'
            };
            btn.textContent = labels[this.currentWay] || '🧩 Way: Unknown';
            if (this.currentWay === 'UNK') {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border border-[var(--border-color)] type-micro font-bold text-zinc-400 transition-all flex items-center justify-center gap-1 cursor-pointer";
            } else {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border-[var(--accent-blue)] type-micro font-bold text-[var(--accent-blue)] transition-all flex items-center justify-center gap-1 cursor-pointer";
            }
        },
        dacTiers: ['Phone', 'Laptop', 'Dongle', 'Desktop'],
        dacDetails: {
            'Phone': { icon: 'app/icons/phone.png', label: 'Phone' },
            'Laptop': { icon: 'app/icons/laptop.png', label: 'Laptop' },
            'Dongle': { icon: 'app/icons/dongle.png', label: 'Dongle' },
            'Desktop': { icon: 'app/icons/desktop.png', label: 'Amp' }
        },
        currentDacIdx: 2,

        cycleDacPower: function(dir) {
            const total = this.dacTiers.length;
            this.currentDacIdx = (this.currentDacIdx + dir + total) % total;
            const activeTier = this.dacTiers[this.currentDacIdx];
            this.updateDacUI(activeTier);
            this.updateAll();
        },
        tonalityTags: [
            {name: "⚖️ Neutral"}, {name: "✨ Bright"}, {name: "🌿 Warm"}, {name: "🌑 Dark"},
            {name: "🔺 V-Shaped"}, {name: "🧲 U-Shaped"}, {name: "🎯 Mid-Forward"}, {name: "🌬️ Airy"},
            {name: "🔍 Detailed"}, {name: "🧈 Smooth"}, {name: "🚀 Energetic"}, {name: "😌 Relaxed"}
        ],
        bassTags: [
            {name: "💥 Basshead"}, {name: "🐋 Deep Bass"}, {name: "📳 Rumble"}, {name: "👊 Punchy"},
            {name: "🎚️ Controlled"}, {name: "🎈 Light Bass"}, {name: "💨 Fast Bass"}, {name: "🪨 Thick Bass"},
            {name: "🧼 Clean Bass"}, {name: "🫀 Slam"}
        ],
        genreTags: [
            {name: "📱 All-Rounder"}, {name: "🎤 Vocal"}, {name: "🎸 Rock"}, {name: "🔊 EDM"},
            {name: "🎧 Hip-Hop"}, {name: "🎹 Pop"}, {name: "🎻 Classical"}, {name: "🎷 Jazz"},
            {name: "🤠 Country"}, {name: "🎼 Orchestra"}, {name: "🎮 Gaming"}, {name: "🎬 Movies"},
            {name: "🧐 Critical"}
        ],

        init: function() {
            this.initGauges();
            this.updateSensUnitUI();

            this.runDriverAutoLogic();
            this.initImageControls();

                        this.sliderNodes = Array.from(document.querySelectorAll('.iem-slider')).map(s => {
                return { element: s, displayValueNode: document.getElementById(s.id + '-val') };
            });

            this.debouncedUpdateAll = rafThrottle(() => this.updateAll());
            // index.html's #lib-search oninput calls IEM.debouncedRenderLibrary(),
            // which was never defined -- every keystroke threw and the
            // Library search never filtered as you typed.
            this.debouncedRenderLibrary = debounce(() => this.renderLibrary(), 180);

            this.updateDacUI(this.dacTiers[this.currentDacIdx]);
            this.renderReviewSelectedTags();
            this.setFormFactor(this.formFactor || 'IEM');
            this.setConnector(this.connector || '2-pin');
            this.renderIemDbSearch('');
            this.switchLeftTab(this.activeLeftTab || 'info');
            this.updateAll();
        },
        ensureChartReady: async function() {
            if (this.radarChart) return;
            if (!this._chartJsLoadPromise) {
                this._chartJsLoadPromise = (typeof Chart !== 'undefined')
                    ? Promise.resolve(true)
                    : EQ_Module.injectScriptAsync('app/js/chart.js');
            }
            await this._chartJsLoadPromise;
            if (this.radarChart || typeof Chart === 'undefined') return;

            this.initChart();
            this.updateAll();

        },
        initChart: function() {
            const ctx = document.getElementById('radarChart').getContext('2d');
        const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
        const activeThemeConfig = (window.App && App.themeMap && App.themeMap[savedThemeId]) || {};
        const themeVars = activeThemeConfig.variables || {};
        const accentColor = activeThemeConfig.accent || themeVars['--accent-blue'] || '#6488b0';
        const pointLabelColor = themeVars['--text-main'] || '#f0f0f4';
        const gridColor = themeVars['--text-secondary'] ? themeVars['--text-secondary'] + '40' : 'rgba(255, 255, 255, 0.15)';
        this.radarChart = new Chart(ctx, {
            type: 'radar',
            data: { labels: ['Bass', 'Mids', 'Treble', 'Detail', 'Soundstage', 'Imaging', 'Dynamics', 'Tonality', 'Technicalities'], datasets: [{ label: 'Sound Profile', data: [5, 5, 5, 5, 5, 5, 5, 5, 5], backgroundColor: accentColor + '22', borderColor: accentColor, pointBackgroundColor: accentColor, borderWidth: 2, pointRadius: 4, pointHoverRadius: 7, pointHitRadius: 12 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 10, bottom: 15, left: 10, right: 10 } },
                    scales: { r: { min: 0, max: 10, ticks: { display: false, stepSize: 2 }, grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: pointLabelColor, font: { size: 10, weight: 'bold', family: 'system-ui, -apple-system, sans-serif' } } } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: true,
                            titleAlign: 'center',
                            bodyAlign: 'center',
                            displayColors: false,
                            callbacks: {
                                title: function(context) {
                                    const label = context[0].label;
                                    const emojiMap = {
                                        'Bass': '🥁 Bass',
                                        'Mids': '🎤 Mids',
                                        'Treble': '✨ Treble',
                                        'Detail': '🔍 Detail',
                                        'Soundstage': '🏟️ Soundstage',
                                        'Imaging': '🎯 Imaging',
                                        'Dynamics': '📈 Dynamics',
                                        'Tonality': '🎼 Tonality',
                                        'Technicalities': '🔬 Technicalities'
                                    };
                                    return emojiMap[label] || label;
                                },
label: function(context) {
                                            // context.raw is the unrounded axis
                                            // value, so this rendered as
                                            // "Score: 5.4399999999999995". A
                                            // score readout does not need more
                                            // than one decimal.
                                            const n = Number(context.raw);
                                            return 'Score: ' + (isFinite(n) ? n.toFixed(1) : '0.0');
                                        }
                            }
                        }
                    },
                    animation: { duration: 250 } }
            });
        },
        initGauges: function() {
            document.querySelectorAll('.gauge-container').forEach(container => {
                let isDragging = false;
                let updatePending = false;

                const id = container.getAttribute('data-id');
                const min = parseFloat(container.getAttribute('data-min'));
                const max = parseFloat(container.getAttribute('data-max'));
                const input = document.getElementById(id);

                const startDrag = (e) => {
                    isDragging = true;
                    updateFromMouse(e);
                };

                const updateFromMouse = (e) => {
                    if (!isDragging) return;
                    if (updatePending) return;

                    updatePending = true;
                    requestAnimationFrame(() => {
                        updatePending = false;

                        const rect = container.getBoundingClientRect();
                        const clientX = e.touches ? (e.touches[0]?.clientX || e.changedTouches[0]?.clientX) : e.clientX;
                        if (clientX === undefined) return;

                        let percent = (clientX - rect.left) / rect.width;
                        percent = Math.max(0, Math.min(1, percent));
                        const newValue = Math.round(min + (percent * (max - min)));

                        if (input) input.value = newValue;
                        IEM_Module.updateGauge(id, newValue);
                        IEM_Module.updateAll();
                    });
                };

                const stopDrag = () => {
                    if (isDragging) {
                        isDragging = false;
                        document.removeEventListener('mousemove', updateFromMouse);
                        document.removeEventListener('mouseup', stopDrag);
                    }
                };

                container.addEventListener('mousedown', (e) => {
                    startDrag(e);

                    document.addEventListener('mousemove', updateFromMouse);
                    document.addEventListener('mouseup', stopDrag);
                });

                container.addEventListener('touchstart', (e) => {
                    isDragging = true;
                    updateFromMouse(e.touches[0] || e.changedTouches[0]);

                    const touchMove = (evt) => { if (isDragging) updateFromMouse(evt.touches[0] || evt.changedTouches[0]); };
                    const touchEnd = () => {
                        isDragging = false;
                        document.removeEventListener('touchmove', touchMove);
                        document.removeEventListener('touchend', touchEnd);
                    };
                    document.addEventListener('touchmove', touchMove, { passive: true });
                    document.addEventListener('touchend', touchEnd);
                }, { passive: true });
            });
        },
        updateGauge: function(id, val) {
            const numVal = parseFloat(val);
            const needle = document.getElementById(`${id}-needle`);
            const light = document.getElementById(`${id}-light`);
            const input = document.getElementById(id);
            // Sensitivity range widened from [80,125] to [55,150]: dB/V values
            // (dB/mW + 10*log10(1000/Z)) legitimately reach ~148 dB/V at low
            // impedance, and 615 DB entries fall outside the old window — the
            // old clamp corrupted unit-toggle round-trips by up to 8 dB.
            const config = { impedance: { min: 5, max: 300 }, sensitivity: { min: 55, max: 150 } };
            const constraint = config[id];

            if (!constraint || !needle) return;
            const clamped = Math.max(constraint.min, Math.min(constraint.max, numVal));
            const normalized = (clamped - constraint.min) / (constraint.max - constraint.min);
            const rotation = (normalized * 180) - 90;

            needle.style.transition = "transform .5s cubic-bezier(.22, 1, .36, 1)";
            needle.style.transform = `rotate(${rotation}deg)`;

            const impedance = id === "impedance" ? clamped : parseFloat(document.getElementById("impedance")?.value || 32);
            const sensitivity = id === "sensitivity" ? clamped : parseFloat(document.getElementById("sensitivity")?.value || 100);

            let difficulty = 0;

            if (impedance > 150) {
                difficulty += 45;
            } else if (impedance > 64) {
                difficulty += 25;
            } else if (impedance > 32) {
                difficulty += 10;
            }

            if (sensitivity < 90) {
                difficulty += 60;
            } else if (sensitivity < 100) {
                difficulty += 35;
            } else if (sensitivity < 105) {
                difficulty += 15;
            }

            difficulty = Math.min(100, difficulty);

            let targetColor;
            let status;

            if (difficulty < 20) {
                targetColor = '#22c55e';
                status = "easy";
            } else if (difficulty < 45) {
                targetColor = '#06b6d4';
                status = "normal";
            } else if (difficulty < 70) {
                targetColor = '#facc15';
                status = "moderate";
            } else {
                targetColor = '#ef4444';
                status = "hard";
            }

            if (input) {
                input.style.color = targetColor;
                input.style.textShadow = `0 0 6px ${targetColor}40`;
            }

            if (light) {
                light.style.backgroundColor = targetColor;
                light.style.boxShadow = `0 0 10px ${targetColor}`;
                light.className = `gauge-light ${status}`;
            }

            const slider = document.getElementById(`${id}-slider`);
            if (slider && parseFloat(slider.value) !== clamped) {
                slider.value = clamped;
                if (window.syncGlobalSliders) window.syncGlobalSliders();
            }
        },
        handleGaugeSlider: function(id, val) {
            const input = document.getElementById(id);
            if (input) {
                let snapVal = parseFloat(val);

                if (id === 'impedance') {
                    const commonOhms = [8, 12, 16, 18, 24, 32];
                    const threshold = 1.5;
                    for (let k = 0; k < commonOhms.length; k++) {
                        if (Math.abs(snapVal - commonOhms[k]) <= threshold) {
                            snapVal = commonOhms[k];
                            const slider = document.getElementById('impedance-slider');
                            if (slider) slider.value = snapVal;
                            break;
                        }
                    }
                }

                input.value = Math.round(snapVal);
                this.updateGauge(id, snapVal);
                this.updateAll();
            }
        },
        updateDacUI: function(dacName) {
            const btnLabel = document.getElementById('dac-btn-label');
            if (btnLabel) {
                const info = (this.dacDetails && this.dacDetails[dacName]) ? this.dacDetails[dacName] : { icon: 'app/icons/dongle.png', label: dacName };
                btnLabel.innerHTML = `<img src="${info.icon}" class="w-6 h-6 object-contain flex-shrink-0 inline-block anim-toggle-pop"> ${info.label}`;
            }
        },
        // Must stay in step with #sound-char-tabs: six pills in the markup
        // (bass / mids / treble / stage / fit / package), so six here. Package
        // was missing, which made the list disagree with the row it describes.
        soundCharModes: [
            { id: 'bass', label: 'Bass', emoji: '🥁' },
            { id: 'mids', label: 'Mids', emoji: '🎤' },
            { id: 'treble', label: 'Treble', emoji: '✨' },
            { id: 'stage', label: 'Stage', emoji: '🏟️' },
            { id: 'fit', label: 'Fit', emoji: '🎧' },
            { id: 'package', label: 'Package', emoji: '📦' }
        ],
        activeSoundCharTab: 'bass',
        switchSoundCharTab: function(tabId) {
            this.activeSoundCharTab = tabId;
            // aria-selected moves with .active so the pill row is announced
            // correctly rather than only looking selected.
            document.querySelectorAll('#sound-char-tabs button').forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            const activeTabBtn = document.getElementById('sc-tab-' + tabId);
            if (activeTabBtn) {
                activeTabBtn.classList.add('active');
                activeTabBtn.setAttribute('aria-selected', 'true');
            }

            document.querySelectorAll('.sound-char-panel').forEach(panel => panel.classList.add('hidden'));
            const activePanel = document.getElementById('sc-panel-' + tabId);
            if (activePanel) activePanel.classList.remove('hidden');
        },

        // Canonical registry from data-core.js, decorated with the shared emoji.
        // A getter (not a snapshot) because DataCore is concatenated after this
        // file; it is only read at runtime, long after boot.
        get allReviewTags() {
            if (typeof DataCore !== 'undefined' && DataCore && DataCore.APPROVED_TAGS) {
                return DataCore.APPROVED_TAGS.map(t => ((DataCore.TAG_EMOJI && DataCore.TAG_EMOJI[t]) || '🏷️') + ' ' + t);
            }
            return [];
        },
        currentReviewTagIndex: 0,

        cycleReviewTag: function(dir) {
            const total = this.allReviewTags.length;
            // Guard the empty registry: without tags `% 0` is NaN, which then
            // poisoned currentReviewTagIndex and the preview label.
            if (!total) return;
            this.currentReviewTagIndex = (this.currentReviewTagIndex + dir + total) % total;
            this.updateReviewTagPreviewLabel();
        },

        updateReviewTagPreviewLabel: function() {
            const label = document.getElementById('label-review-tag-select');
            if (!label) return;
            const tag = this.allReviewTags[this.currentReviewTagIndex] || this.allReviewTags[0];
            const match = tag.match(/^(\p{Extended_Pictographic}+(?:\uFE0F|\uFE0E)?)/u);
            let emoji = "🏷️";
            let text = tag;
            if (match) {
                emoji = match[1];
                text = tag.slice(emoji.length).trim();
            }
            const animClass = FindEngine.getTagAnimationClass ? FindEngine.getTagAnimationClass(text) : 'anim-toggle-pop';
            label.innerHTML = `<span class="emoji-font vibrant-emoji ${animClass} text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5">${emoji}</span> ${text}`;
        },

        addCurrentReviewTag: function() {
            const tag = this.allReviewTags[this.currentReviewTagIndex] || this.allReviewTags[0];
            this.addReviewTagFromSelect(tag);
        },
        addReviewTagFromSelect: function(tagName) {
            if (!tagName) return;
            const totalSelected = this.selectedTags.size + this.selectedGenres.size + this.selectedBass.size;
            if (totalSelected >= 4) {
                showToast("Limit: Maximum 4 signature tags allowed.", "⚠️");
                return;
            }

            this.selectedTags.add(tagName);

            this.renderReviewSelectedTags();
            this.updateAll();
        },
        removeReviewTag: function(tagName) {
            this.selectedTags.delete(tagName);
            this.selectedBass.delete(tagName);
            this.selectedGenres.delete(tagName);
            this.renderReviewSelectedTags();
            if (window.hideGlobalTooltip) window.hideGlobalTooltip();
            const tt = document.getElementById('global-floating-tooltip');
            if (tt) { tt.style.opacity='0'; tt.style.display='none'; }
            this.updateAll();
        },
        getTagAnimationClass: function(tag) {
                    return 'anim-toggle-pop';
                },

        renderReviewSelectedTags: function() {
            const container = document.getElementById('review-selected-tags-container');
            if (!container) return;
            container.innerHTML = '';

            const allActive = [
                ...Array.from(this.selectedTags),
                ...Array.from(this.selectedBass),
                ...Array.from(this.selectedGenres)
            ];

            for (let i = 0; i < 4; i++) {
                const tag = allActive[i];
                if (tag) {
                    const match = tag.match(/^(\p{Extended_Pictographic}+(?:\uFE0F|\uFE0E)?)/u);
                    let emoji = "🏷️";
                    let text = tag;
                    if (match) {
                        emoji = match[1];
                        text = tag.slice(emoji.length).trim();
                    }

                    const animClass = this.getTagAnimationClass(tag);

                    const div = document.createElement('div');
                    div.className = 'bg-[var(--bg-card)] border-2 border-[var(--border-color)] px-2 py-1 flex items-center justify-between gap-1 select-none w-full h-full relative';
                    div.style.cssText = 'box-shadow: 2px 2px 0px 0px var(--border-color) !important;';
                    // DOM-built, no innerHTML: tags come from profiles that can
                    // be imported from JSON files (selectedTags is attacker-
                    // controllable text), and both the chip body and the
                    // inline onclick string literal were raw-interpolated.
                    const inner = document.createElement('div');
                    inner.className = 'flex items-center gap-2 min-w-0 flex-1 overflow-visible';
                    const emojiSpan = document.createElement('span');
                    emojiSpan.className = `emoji-font vibrant-emoji ${animClass} text-2xl flex-shrink-0 leading-none`;
                    emojiSpan.style.cssText = 'display: inline-block; transform-origin: center;';
                    emojiSpan.textContent = emoji;
                    const textSpan = document.createElement('span');
                    textSpan.className = 'type-micro font-black text-[var(--text-main)] truncate leading-tight';
                    textSpan.textContent = text;
                    inner.appendChild(emojiSpan);
                    inner.appendChild(textSpan);

                    const rmBtn = document.createElement('button');
                    rmBtn.type = 'button';
                    rmBtn.className = 'w-4 h-4 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white type-micro font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black';
                    rmBtn.title = 'Remove ' + text;
                    rmBtn.textContent = '✕';
                    const tagToRemove = tag;
                    rmBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        IEM_Module.removeReviewTag(tagToRemove);
                    });

                    div.appendChild(inner);
                    div.appendChild(rmBtn);
                    container.appendChild(div);
                } else {
                    const div = document.createElement('div');
                    div.className = 'border-2 border-dashed border-black p-1 flex items-center justify-center select-none w-full h-full bg-black/10';
                    div.innerHTML = `<span class="type-micro font-black text-stone-400 uppercase tracking-wider">+ Slot ${i+1}</span>`;
                    container.appendChild(div);
                }
            }
        },
        updateBrandSuggestions: function(query) {
            const box = document.getElementById('brand-suggestions');
            if (!box) return;
            const q = (query || '').trim();

            // typeof guards: FindEngine and CurveIndexer are top-level consts
            // in the bundle (never on window), so the old window.* checks made
            // db always [] — the brand autocomplete never showed anything.
            const db = ((typeof FindEngine !== 'undefined' && FindEngine.iemDatabase && FindEngine.iemDatabase.length > 0)
                ? FindEngine.iemDatabase
                : ((typeof CurveIndexer !== 'undefined' && CurveIndexer.catalog) ? CurveIndexer.catalog : []));
            const normQ = q.toLowerCase();
            const seen = new Set();
            const matches = [];
            for (let i = 0; i < db.length; i++) {
                const brand = db[i] && db[i].brand;
                if (!brand || seen.has(brand)) continue;
                if (q.length < 1 || brand.toLowerCase().includes(normQ)) {
                    seen.add(brand);
                    matches.push(brand);
                }
            }
            matches.sort((a, b) => a.localeCompare(b));

            if (matches.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }

            if (box.parentNode !== document.body) {
                document.body.appendChild(box);
            }

            // data-cmd, not an attribute-form handler. This was
            // `onmousedown="event.preventDefault(); ..."`, which Chromium refuses
            // to compile under `script-src 'self' 'wasm-unsafe-eval'` (no
            // 'unsafe-inline'): the rows rendered and clicking did nothing. See
            // scripts/check-integrity.mjs check #4, which ratchets this form.
            //
            // click rather than mousedown: the #brand blur handler that hides
            // this box is a 200ms setTimeout, and click lands well inside that
            // window, so the suggestion is applied before the box closes. It
            // also means no `preventDefault` is needed, so the dropdown no
            // longer swallows the focus change.
            box.innerHTML = matches.map(b => `
                <div class="p-1.5 text-xs font-bold text-zinc-200 cursor-pointer hover:bg-[var(--accent-blue)] hover:text-white select-none" data-cmd="IEM.selectBrandSuggestion" data-arg-0="${esc(b)}">${esc(b)}</div>
            `).join('');

            const inputEl = document.getElementById('brand');
            if (inputEl) {
                const rect = inputEl.getBoundingClientRect();
                box.style.position = 'fixed';
                box.style.left = rect.left + 'px';
                box.style.top = (rect.bottom + 2) + 'px';
                box.style.width = rect.width + 'px';
                box.style.right = 'auto';
                box.style.zIndex = '99999';
            }
            box.classList.remove('hidden');
        },

        // Backs the #brand-suggestions rows. Was an inline `onmousedown` string,
        // so the whole autocomplete was dead under the shipped CSP.
        selectBrandSuggestion: function(value) {
            if (value === undefined || value === null) return;
            const input = document.getElementById('brand');
            if (input) input.value = String(value);
            const box = document.getElementById('brand-suggestions');
            if (box) {
                box.classList.add('hidden');
                box.innerHTML = '';
            }
        },

        incrementDriver: function(type) {
            if (!this.selectedDriverTypes) this.selectedDriverTypes = {};
            const cur = this.selectedDriverTypes[type] || 0;
            this.selectedDriverTypes[type] = Math.min(99, cur + 1);
            this.lastUpdatedDriverType = type;
            this.playDriverSound(type);
            this.runDriverAutoLogic();
        },
        decrementDriver: function(type) {
            if (!this.selectedDriverTypes) return;
            const cur = this.selectedDriverTypes[type] || 0;
            if (cur <= 1) {
                delete this.selectedDriverTypes[type];
            } else {
                this.selectedDriverTypes[type] = cur - 1;
            }
            this.lastUpdatedDriverType = type;
            this.playDriverSound(type);
            this.runDriverAutoLogic();
        },
        playDriverSound: function(type) {
            try {
                const ctx = SharedAudio.init();
                if (!ctx) return;
                if (ctx.state === 'suspended') ctx.resume();

                const now = ctx.currentTime;
                const outNode = SharedAudio.masterGain || ctx.destination;

                const playSynth = (cfg) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();

                    osc.type = cfg.type || 'sine';
                    osc.frequency.setValueAtTime(cfg.startFreq, now);
                    if (cfg.endFreq) {
                        osc.frequency.linearRampToValueAtTime(cfg.endFreq, now + cfg.duration);
                    }

                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(cfg.maxGain, now + 0.008);
                    gain.gain.linearRampToValueAtTime(0.001, now + cfg.duration);

                    if (cfg.filterType) {
                        const filter = ctx.createBiquadFilter();
                        filter.type = cfg.filterType;
                        filter.frequency.value = cfg.filterFreq;
                        osc.connect(gain);
                        gain.connect(filter);
                        filter.connect(outNode);
                    } else {
                        osc.connect(gain);
                        gain.connect(outNode);
                    }

                    osc.start(now);
                    osc.stop(now + cfg.duration + 0.02);
                };

                const configMap = {
                    DD: { type: 'sine', startFreq: 180, endFreq: 40, maxGain: 0.35, duration: 0.18 },
                    BA: { type: 'triangle', startFreq: 800, endFreq: 1400, maxGain: 0.25, duration: 0.08 },
                    Planar: { type: 'sawtooth', startFreq: 500, endFreq: 1200, maxGain: 0.22, duration: 0.14, filterType: 'lowpass', filterFreq: 2200 },
                    BC: { type: 'sine', startFreq: 100, endFreq: 25, maxGain: 0.40, duration: 0.28 },
                    EST: { type: 'sine', startFreq: 3500, endFreq: 7000, maxGain: 0.20, duration: 0.09 },
                    PZT: { type: 'sine', startFreq: 2400, endFreq: 4800, maxGain: 0.22, duration: 0.12 },
                    MEMS: { type: 'square', startFreq: 1800, endFreq: 3200, maxGain: 0.18, duration: 0.06 }
                };

                const cfg = configMap[type];
                if (cfg) {
                    playSynth(cfg);
                    if (type === 'PZT') {
                        playSynth({ type: 'sine', startFreq: 4800, endFreq: 7200, maxGain: 0.10, duration: 0.12 });
                    }
                }
            } catch (e) {
                console.warn("Driver synth audio playback failed:", e);
            }
        },
        runDriverAutoLogic: function() {
            let totalDrivers = 0;
            let solvedActiveTypesCount = 0;
            let containsEST = false;
            let containsBA = false;
            let containsDD = false;
            let containsPlanar = false;

            if (!this.selectedDriverTypes) this.selectedDriverTypes = {};

            Object.entries(this.selectedDriverTypes).forEach(([type, count]) => {
                if (count > 0) {
                    totalDrivers += count;
                    solvedActiveTypesCount++;
                    if (type === 'EST') containsEST = true;
                    if (type === 'BA') containsBA = true;
                    if (type === 'DD') containsDD = true;
                    if (type === 'Planar') containsPlanar = true;
                }
            });

            if (totalDrivers === 0) {
                this.crossoverOverride = false;
                this.wayOverride = false;
            }

            // Single-type arrays share one circuit (no crossover) — Planar,
            // DD, EST/PZT/BC/MEMS alike. BA arrays are the exception: multi-BA
            // sets standardly use crossovers. Multi-type mixes use PASS.
            const singleTypeNoXo = solvedActiveTypesCount === 1 && !containsBA;
            if (!this.crossoverOverride) {
                if (totalDrivers === 0) {
                    this.currentCrossover = 'UNK';
                } else if (totalDrivers === 1) {
                    this.currentCrossover = 'NONE';
                } else if (singleTypeNoXo) {
                    this.currentCrossover = 'NONE';
                } else {
                    this.currentCrossover = 'PASS';
                }
                this.updateCrossoverButtonsUI();
            }

            if (!this.wayOverride) {
                if (totalDrivers === 0) {
                    this.currentWay = 'UNK';
                } else if (totalDrivers === 1) {
                    this.currentWay = '1W';
                } else {
                    if (singleTypeNoXo || (containsBA && solvedActiveTypesCount === 1)) {
                        this.currentWay = '1W';
                    } else {
                        if (totalDrivers === 2) this.currentWay = '2W';
                        else if (totalDrivers === 3) this.currentWay = '3W';
                        else if (totalDrivers === 4) this.currentWay = '4W';
                        else if (totalDrivers === 5) this.currentWay = '5W';
                        else if (totalDrivers >= 6) this.currentWay = '6W+';
                    }
                }
                this.updateWayButtonsUI();
            }

            this.updateDriverSummary();
        },
        toggleCustomTagMenu: function() {
            // (the review tag menu was removed from the markup)
        },

        renderReviewTagMenuOptions: function() {
            // (the review tag menu was removed from the markup)
        },

        updateDriverSummary: function() {
            const r1Container = document.getElementById('driver-row-1');
            const r2Container = document.getElementById('driver-row-2');
            if (!r1Container || !r2Container) return;

            r1Container.innerHTML = '';
            r2Container.innerHTML = '';

            const row1List = [
                { type: 'DD', label: 'Dynamic', icon: 'dd.png' },
                { type: 'BA', label: 'Armature', icon: 'ba.png' },
                { type: 'Planar', label: 'Planar', icon: 'planar.png' }
            ];

            const row2List = [
                { type: 'BC', label: 'Bone Cond', icon: 'bc.png' },
                { type: 'EST', label: 'Electrostat', icon: 'est.png' },
                { type: 'PZT', label: 'Piezo', icon: 'pzt.png' },
                { type: 'MEMS', label: 'Micro', icon: 'mems.png' }
            ];

            const activeDict = this.selectedDriverTypes || {};
            let totalDrivers = 0;

            const renderItem = (d, container) => {
                const count = activeDict[d.type] || 0;
                const isActive = count > 0;
                if (isActive) {
                    totalDrivers += count;
                }

                const isRecentlyUpdated = (this.lastUpdatedDriverType === d.type);

                const div = document.createElement('div');
                div.className = 'flex flex-col items-center gap-1 select-none text-center bg-transparent border-none w-full relative transition-all cursor-default';

                div.innerHTML = `
                    <div class="flex flex-col items-center leading-none overflow-visible">
                        <img src="app/icons/${d.icon}" class="driver-icon ${isActive ? 'is-on' : ''} ${isRecentlyUpdated && isActive ? 'driver-pulse-active' : ''}" style="transform-origin: center;">
                        <span class="driver-count ${isActive ? 'is-on' : ''}">${count} ${d.type}</span>
                    </div>

                    <div class="driver-step">
                        <button type="button" data-cmd="IEM.decrementDriver" data-arg-0="${d.type}" class="driver-step-btn driver-step-dec ${!isActive ? 'is-off' : ''}" aria-label="Fewer ${d.type} drivers">−</button>
                        <button type="button" data-cmd="IEM.incrementDriver" data-arg-0="${d.type}" class="driver-step-btn driver-step-inc" aria-label="More ${d.type} drivers">+</button>
                    </div>
                `;
                container.appendChild(div);
            };

            row1List.forEach(d => renderItem(d, r1Container));
            row2List.forEach(d => renderItem(d, r2Container));

            this.lastUpdatedDriverType = null;
            const badge = document.getElementById('driver-header-count-badge');
            if (badge) badge.textContent = totalDrivers + (totalDrivers === 1 ? " Unit" : " Units");

            this.renderReviewTagMenuOptions();
            this.updateAll();
        },
        createTags: function(containerId, tagsArray, selectedSet) {
         const container = document.getElementById(containerId);
         if (!container) return;
         container.innerHTML = '';
            tagsArray.forEach(tag => {
                const div = document.createElement('div'); div.className = `tag`; const lbl = document.createElement('span'); lbl.textContent = tag.name; div.appendChild(lbl);
                if (selectedSet.has(tag.name)) {
                    div.classList.add('active');
                }
                div.onclick = () => {
                    if (selectedSet.has(tag.name)) {
                        selectedSet.delete(tag.name);
                        div.classList.remove('active');
                    } else {
                        const totalSelected = this.selectedTags.size + this.selectedGenres.size + this.selectedBass.size;
                        if (totalSelected >= 4) {
                            showToast("Limit: Maximum of 4 signature tags active for export.", "⚠️");
                            return;
                        }
                        selectedSet.add(tag.name);
                        div.classList.add('active');
                    }
                    this.updateAll();
                };
                container.appendChild(div);
            });
        },

        updateConfidence: function() {
        },
        updateAll: function() {
            this.updateExportAvailability();
            let totalScore = 0; let count = 0; let valMap = {};
            const acousticSliders = [
                'bass', 'sub-bass-extension', 'mid-bass-punch', 'bass-texture', 'bass-speed',
                'lower-mids', 'upper-mids', 'vocals', 'vocal-fullness', 'mid-naturalness',
                'treble-energy', 'treble-smooth', 'treble-extension', 'sibilance', 'treble-detail',
                'soundstage-width', 'soundstage-depth', 'resolution-detail', 'macro-dynamics',
                'imaging-precision', 'instrument-separation', 'timbre-coherence'
            ];
            // Sibilance is a defect: higher harshness must score LOWER, so its
            // contribution is inverted. upper-mids/vocals are the same
            // measurement (fillToneSliders assigns identical values); count
            // the pair once (0.5 weight each) instead of twice.
            const scoreWeight = (id) => (id === 'upper-mids' || id === 'vocals') ? 0.5 : 1.0;
            const scoredVal = (id, norm) => (id === 'sibilance' ? 10 - norm : norm);
            this.sliderNodes.forEach(node => {
                let val = parseFloat(node.element.value);

                if (Math.abs(val) <= 0.05) {
                    val = 0.0;
                    node.element.value = "0.0";
                }

                const normVal = (val + 10) / 2;
                valMap[node.element.id] = normVal;
                if (node.displayValueNode) {
                    node.displayValueNode.textContent = (val >= 0 ? "+" : "") + val.toFixed(1);
                    if (acousticSliders.includes(node.element.id)) {
                        totalScore += scoredVal(node.element.id, normVal) * scoreWeight(node.element.id);
                        count += scoreWeight(node.element.id);
                    }
                }
                // Repaint the bipolar fill here: DB profile fills, library loads
                // and resets set .value programmatically (no input event fires),
                // and the old polling tick that used to mask this gap was
                // removed. paintSliderTrack skips identical gradients, so the
                // per-node cost on manual drags is a string compare.
                if (window.paintSliderTrack) window.paintSliderTrack(node.element);
                else if (window.syncGlobalSliders) window.syncGlobalSliders(node.element);
            });
            const avg = (...ids) => ids.reduce((sum, id) => sum + (valMap[id] !== undefined ? valMap[id] : 5.0), 0) / ids.length;
            // Scoring view: sibilance inverted (defect), upper-mids/vocals
            // de-duplicated (same measurement counted once).
            const scoreOf = (id) => {
                const v = valMap[id] !== undefined ? valMap[id] : 5.0;
                return id === 'sibilance' ? 10 - v : v;
            };
            const avgScore = (...ids) => ids.reduce((sum, id) => sum + scoreOf(id), 0) / ids.length;

            let impVal = parseFloat(elValue('impedance'));
            if (isNaN(impVal) || impVal <= 0) impVal = 5;
            let sensVal = parseFloat(elValue('sensitivity'));
            if (isNaN(sensVal)) sensVal = 80;

            this.updateGauge('impedance', impVal);
            this.updateGauge('sensitivity', sensVal);

            if (window.EQ && EQ.applySourceSimulation) {
                EQ.applySourceSimulation();
            }

            const dacImpedances = {
                'Phone': 6.0,
                'Laptop': 3.5,
                'Dongle': 1.0,
                'Desktop': 0.1
            };
            const dacLimits = {
                'Phone': { v: 0.4, p: 8 },
                'Laptop': { v: 1.0, p: 30 },
                'Dongle': { v: 2.0, p: 100 },
                'Desktop': { v: 4.0, p: 1000 }
            };

            const activeDacName = this.dacTiers[this.currentDacIdx];
            const dac = dacLimits[activeDacName] || dacLimits['Dongle'];
            const Rs = dacImpedances[activeDacName] || 1.0;

            let pReqIem, vReqIem;
            const splTarget = this.getListeningSplTarget();
            if (this.sensUnit === 'V') {
                vReqIem = Math.pow(10, (splTarget - sensVal) / 20);
                pReqIem = (vReqIem * vReqIem / impVal) * 1000;
            } else {
                pReqIem = Math.pow(10, (splTarget - sensVal) / 10);
                vReqIem = Math.sqrt((pReqIem * impVal) / 1000);
            }

            const vDivider = impVal / (impVal + Rs);
            const vReqSource = vReqIem / vDivider;

            // Total power drawn from the source (including Rs) — kept for reference but
            // NOT used for the compatibility ratio: dac.p is a load-referenced rating
            // (e.g. “100 mW @ 32Ω”), so the correct comparison is load power pReqIem.
            const pDrawnSource = (vReqSource * vReqSource) / (impVal + Rs) * 1000;

            const dampingFactor = impVal / Rs;

            const voltageRatio = vReqSource / dac.v;
            const powerRatio = pReqIem / dac.p;

            // Single helper for color + badge — previously duplicated thresholds drifted
            const compatInfo = (function(v, p) {
                if (v <= 1.0 && p <= 1.0) return { color: '#10b981', text: '✅ Good Match', cls: 'anim-good-match' };
                if (v <= 1.5 && p <= 1.5) return { color: '#22c55e', text: '🟡 Okay Match', cls: 'anim-okay-match' };
                if (v <= 2.0 && p <= 2.0) return { color: '#f59e0b', text: '⚠️ Risky Match', cls: 'anim-risky-match' };
                return { color: '#ef4444', text: '❌ Poor Match', cls: 'anim-poor-match' };
            })(voltageRatio, powerRatio);
            const compatColor = compatInfo.color;
            const matchText = compatInfo.text;
            const matchClass = compatInfo.cls;

            let bassText = '';
            let bassClass = '';

            if (dampingFactor >= 20) {
                bassText = '🎯 Tight Bass';
                bassClass = 'anim-tight-bass';
            } else if (dampingFactor >= 12) {
                bassText = '🥊 Punchy Bass';
                bassClass = 'anim-punchy-bass';
            } else if (dampingFactor >= 6) {
                bassText = '🫧 Warm Bass';
                bassClass = 'anim-warm-bass';
            } else if (dampingFactor >= 4) {
                bassText = '🌊 Deep Bass';
                bassClass = 'anim-deep-bass';
            } else if (dampingFactor >= 1.5) {
                bassText = '🌫️ Bloated Bass';
                bassClass = 'anim-bloated-bass';
            } else {
                bassText = '🥀 Weak Bass';
                bassClass = 'anim-weak-bass';
            }

            const vValNode = document.getElementById('voltage-value');
            const pValNode = document.getElementById('power-value');
            const compatBarNode = document.getElementById('compatibility-bar');
            const statusNode = document.getElementById('compatibility-status');

            if (vValNode) vValNode.textContent = Number.isFinite(vReqSource) ? vReqSource.toFixed(2) + " V" : "— V";
            if (pValNode) pValNode.textContent = Number.isFinite(pReqIem) ? pReqIem.toFixed(1) + " mW" : "— mW (over-range)";

            if (statusNode) {
                statusNode.innerHTML = `<span class="${matchClass} text-sm sm:text-base">${matchText}</span>`;
            }

            const maxRatio = Math.max(voltageRatio, powerRatio);
            let compPercent = 100;
            let compColor = '#10b981';

            if (maxRatio <= 1.0) {

                compPercent = Math.round(100 - (maxRatio * 25));
                compColor = compPercent > 82 ? '#10b981' : '#84cc16';
            } else if (maxRatio <= 2.0) {

                compPercent = Math.round(75 - ((maxRatio - 1.0) * 50));
                compColor = '#f59e0b';
            } else {

                compPercent = Math.round(Math.max(3, 25 - ((maxRatio - 2.0) * 10)));
                compColor = '#ef4444';
            }

            if (compatBarNode) {
                compatBarNode.style.width = compPercent + '%';
                compatBarNode.style.backgroundColor = compColor;
            }

            const powerIconEmoji = document.getElementById('power-icon-emoji');
            if (powerIconEmoji) {
                powerIconEmoji.textContent = '🔋';
            }

            // NOTE: the compatibility status is written ONCE, above (with the
            // responsive `text-sm sm:text-base` classes). A second identical
            // innerHTML assignment used to live here and silently overwrote the
            // first, so those classes never applied.

            const notesInput = document.getElementById('review-notes');
            const counter = document.getElementById('notes-counter');
            if (notesInput && counter) {
                const len = notesInput.value.length;
                counter.textContent = `${len}/150`;
                if (len >= 135) {
                    counter.classList.remove('text-zinc-500', 'text-amber-500');
                    counter.classList.add('text-red-500', 'animate-pulse');
                } else if (len >= 100) {
                    counter.classList.remove('text-zinc-500', 'text-red-500', 'animate-pulse');
                    counter.classList.add('text-amber-500');
                } else {
                    counter.classList.remove('text-red-500', 'text-amber-500', 'animate-pulse');
                    counter.classList.add('text-zinc-500');
                }
            }

            const finalScore = count > 0 ? (totalScore / count).toFixed(1) : 5.0;
            const scoreVal = parseFloat(finalScore);
            const scoreEl = document.getElementById('overall-score');
            if (scoreEl) {
                scoreEl.textContent = finalScore;

                scoreEl.classList.remove('text-blue-500', 'text-red-500', 'text-amber-500', 'text-emerald-500');

                if (scoreVal < 5.0) {
                    scoreEl.classList.add('text-red-500');
                } else if (scoreVal < 7.0) {
                    scoreEl.classList.add('text-amber-500');
                } else if (scoreVal < 8.5) {
                    scoreEl.classList.add('text-emerald-500');
                } else {
                    scoreEl.classList.add('text-blue-500');
                }
            }
            const techScore = avg('resolution-detail', 'imaging-precision', 'macro-dynamics', 'instrument-separation');
            const toneScore = avg('timbre-coherence', 'mid-naturalness', 'vocals', 'treble-smooth');
            const bassScore = avg('bass', 'sub-bass-extension', 'mid-bass-punch');
            const trebleScore = avgScore('treble-energy', 'treble-detail', 'sibilance');

            const badge = document.getElementById('bias-badge');
            let biasStr, biasClass;

            const unifiedBiasClass = 'text-xs uppercase tracking-wider font-black px-3 py-1 bg-[var(--bg-input)] border-2 border-black text-[var(--text-main)] w-full text-center transition-all shadow-[2px_2px_0px_0px_#000]';

            if (bassScore > toneScore + 1.2 && bassScore > techScore + 1.2) {
                biasStr = '💥 Basshead & Warm Bias';
            } else if (trebleScore > toneScore + 1.2 && trebleScore > bassScore + 1.0) {
                biasStr = '✨ Bright / V-Shape Bias';
            } else if (techScore > toneScore + 0.5) {
                biasStr = '🔬 Analytical & Technical Bias';
            } else if (toneScore > techScore + 0.5) {
                biasStr = '🎵 Musical & Natural Bias';
            } else {
                biasStr = '⚖️ Neutral';
            }
            biasClass = unifiedBiasClass;
            if(badge) { badge.innerHTML = biasStr; badge.className = biasClass; }
if(this.radarChart) {
                const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                const activeThemeConfig = (window.App && App.themeMap && App.themeMap[savedThemeId]) || {};
                const themeVars = activeThemeConfig.variables || {};
                const accentColor = activeThemeConfig.accent || themeVars['--accent-blue'] || '#6488b0';
                this.radarChart.data.datasets[0].borderColor = accentColor;
                this.radarChart.data.datasets[0].pointBackgroundColor = accentColor;
                this.radarChart.data.datasets[0].backgroundColor = accentColor + '22';
                if (this.radarChart.options && this.radarChart.options.scales && this.radarChart.options.scales.r) {
                    this.radarChart.options.scales.r.pointLabels.color = themeVars['--text-main'] || '#f0f0f4';
                    if (themeVars['--text-secondary']) {
                        this.radarChart.options.scales.r.grid.color = themeVars['--text-secondary'] + '40';
                        this.radarChart.options.scales.r.angleLines.color = themeVars['--text-secondary'] + '40';
                    }
                }
                this.radarChart.data.datasets[0].data = [
                    avg('bass', 'sub-bass-extension', 'bass-texture', 'bass-speed', 'mid-bass-punch'), avg('vocal-fullness', 'lower-mids', 'upper-mids', 'mid-naturalness'),
                    avgScore('treble-energy', 'treble-smooth', 'treble-extension', 'sibilance', 'treble-detail'), valMap['resolution-detail'], avg('soundstage-width', 'soundstage-depth'),
                    valMap['imaging-precision'], valMap['macro-dynamics'], avg('vocals', 'mid-naturalness', 'treble-smooth', 'timbre-coherence'), avg('instrument-separation', 'timbre-coherence', 'ease-of-drive', 'driver-flex')
                ];
                this.radarChart.update('none');
            }

            if (window.EQ) {
                EQ.drawCurve();
            }

            return finalScore;
        },
        // Was a native confirm(), which blocks the renderer on an unstyleable
        // modal and froze the window until a human answered. Now async because
        // UIKit.confirm is a promise; the only caller is the reset button, which
        // never depended on the wipe happening synchronously.
        resetAll: async function() {
            const ok = await UIKit.confirm({
                title: "Clear all current workspace data?",
                message: "This clears the current review (specs, scores, notes, tags, photo, hearing profile and the restored EQ state). Saved reviews, custom EQ presets, Find favourites and your theme/font settings are kept.",
                confirmLabel: "Clear all",
                danger: true
            });
            if (!ok) return;

            // Preserve user preferences that are NOT workspace review data.
            // The old 5-key list let the wipe destroy the Find tab's curated
            // taste favorites, playback/limiter/a11y settings, the hearing
            // profile and reading scale — none of which belong to the review
            // workspace this reset is scoped to.
            const preservedKeys = [
                'iem_library_v2',
                // User-authored EQ presets are NOT review-workspace data. They
                // were missing from this list, so "Clear all" deleted every
                // custom preset the user had saved (eq-presets.js).
                'iem_custom_eq_presets',
                'settings_theme_id', 'settings_export_theme_id', 'settings_font_id',
                'settings_align_hz', 'settings_align_db',
                'settings_reading_scale',
                'settings_audio_mode',
                'settings_gapless', 'settings_crossfade', 'settings_crossfade_secs',
                'settings_merger_limiter',
                'a11y_bluelight',
                'find_taste_favorites', 'find_canonical_profiles'
            ];
            const preserved = {};
            preservedKeys.forEach(k => { preserved[k] = localStorage.getItem(k); });
            localStorage.clear();
            preservedKeys.forEach(k => { if (preserved[k]) localStorage.setItem(k, preserved[k]); });

            this.sliderNodes.forEach(n => { n.element.value = 0.0; });
            document.getElementById('review-notes').value = '';
            document.getElementById('brand').value = '';
            document.getElementById('model').value = '';
            document.getElementById('price').value = '';
            this.setListeningVolume('moderate');
            document.getElementById('impedance').value = '5';
            document.getElementById('sensitivity').value = '80';

            this.clearImage();

            this.selectedTags.clear(); this.selectedGenres.clear(); this.selectedBass.clear();
            this.selectedDriverTypes = {};
            this.setFormFactor('IEM');
            this.setConnector('2-pin');
            this.crossoverOverride = false;
            this.wayOverride = false;
            this.currentCrossover = 'UNK';
            this.currentWay = 'UNK';
            this.updateCrossoverButtonsUI();
            this.updateWayButtonsUI();
            this.runDriverAutoLogic();
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);

            // The hearing-test profile belongs to this workspace — clear its
            // live layer too (previously only the persistence key was wiped,
            // leaving the correction actively applied with a "Hearing: ON"
            // badge that vanished on the next reload).
            if (window.EQ && EQ_Module.hearingCalEnabled) {
                EQ_Module.hearingCalEnabled = false;
                EQ_Module.hearingOffsets = [0, 0, 0, 0, 0, 0, 0, 0];
                if (EQ_Module.applyHearingCalibrationGains) EQ_Module.applyHearingCalibrationGains();
            }
            localStorage.removeItem('settings_hearing_offsets');

            // Sensitivity unit belongs to the spec panel: reset it alongside
            // the sensitivity value (a dB/V session previously kept the V
            // unit with a value reset to 80, producing "over-range" power
            // math until the next toggle).
            this.sensUnit = 'mW';
            this.updateSensUnitUI();

            Tone_Module.reset(); EQ_Module.resetEQ(); TestLab_Module.stopAll(); PEQDB_Module.clearState(); this.updateAll();
            this._iemDbActiveId = null;
            await this.markReviewClean();
        },





    };
Object.assign(IEM_Module, IEM_DbSearchMethods);
Object.assign(IEM_Module, IEM_ImageMethods);
Object.assign(IEM_Module, IEM_LibraryMethods);
Object.assign(IEM_Module, IEM_ExportMethods);
