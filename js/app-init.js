
        (function() {
            // Skip ranges already styled for their current value: the 1s tick
            // otherwise re-reads each slider's computed style on every pass,
            // even when nothing changed since the last update.
            const _lastFill = new WeakMap();
            function updateFill(el) {
                const min = parseFloat(el.min) || 0;
                const max = parseFloat(el.max) || 100;
                const val = parseFloat(el.value) || 0;
                const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
                const target = pct + '%';
                if (_lastFill.get(el) === val + '|' + target) return;
                _lastFill.set(el, val + '|' + target);
                if (el.style.getPropertyValue('--range-fill') !== target) {
                    el.style.setProperty('--range-fill', target);
                }
            }
            document.addEventListener('input', (e) => {
                if (e.target && e.target.matches && e.target.matches('input[type="range"]')) updateFill(e.target);
            }, true);
            function initAll() {
                if (document.hidden || !document.hasFocus()) return;
                document.querySelectorAll('input[type="range"]').forEach(updateFill);
            }
            window.addEventListener('DOMContentLoaded', initAll);

            // 3s polling removed: input listener + visibilitychange + syncGlobalSliders
            // already keep fill bars coherent. The interval was waking the tab every
            // 3s even when hidden/idle.
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) initAll();
            });

            // Best-effort worker cleanup on unload: background workers keep
            // the renderer alive on some engines (e.g. Firefox's bfcache),
            // pinning large structured-cloned datasets in memory.
            window.addEventListener('pagehide', () => {
                try {
                    if (window.FindEngine && FindEngine._findWorker) FindEngine._findWorker.terminate();
                    if (window.FindEngine && FindEngine.similarityWorker) FindEngine.similarityWorker.terminate();
                } catch (_) {}
            });
        })();

        (function() {
            function setup() {
                const slider = document.getElementById('tone-slider');
                const freqDisplay = document.getElementById('tone-freq');
                if (!slider || !freqDisplay) return;

                const MIN = 0, MAX = 20000;

                const commitValue = (val) => {
                    val = Math.max(MIN, Math.min(MAX, Math.round(val)));
                    slider.value = val;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                };

                freqDisplay.style.cursor = 'pointer';
                freqDisplay.title = 'Click to type an exact Hz value';
                freqDisplay.addEventListener('click', () => {
                    if (freqDisplay.querySelector('input')) return;
                    const currentHz = parseFloat(slider.value) || 0;
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.min = MIN; input.max = MAX; input.step = 1;
                    input.value = currentHz;
                    input.className = 'w-24 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-2xl font-black text-[var(--accent-amber)] px-1';
                    freqDisplay.textContent = '';
                    freqDisplay.appendChild(input);
                    input.focus();
                    input.select();

                    let committed = false;
                    const restore = () => { freqDisplay.textContent = slider.value + ' Hz'; };
                    const commitAndRestore = () => {
                        committed = true;
                        const val = Math.max(MIN, Math.min(MAX, Math.round(parseFloat(input.value) || 0)));
                        commitValue(val);
                        restore();
                    };
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { commitAndRestore(); }
                        else if (e.key === 'Escape') { committed = true; restore(); }
                        e.stopPropagation();
                    });
                    input.addEventListener('blur', () => {
                        if (committed) return;
                        // An empty/invalid box restores the previous value
                        // instead of silently committing 0 Hz.
                        if (!input.value.trim() || isNaN(parseFloat(input.value))) { restore(); return; }
                        commitAndRestore();
                    });
                    input.addEventListener('click', (e) => e.stopPropagation());
                });
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        })();
