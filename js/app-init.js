
        (function() {
            function updateFill(el) {
                const min = parseFloat(el.min) || 0;
                const max = parseFloat(el.max) || 100;
                const val = parseFloat(el.value) || 0;
                const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
                const target = pct + '%';
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

            setInterval(initAll, 1000);
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

                    const commitAndRestore = () => {
                        const val = Math.max(MIN, Math.min(MAX, Math.round(parseFloat(input.value) || 0)));
                        commitValue(val);
                    };
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { commitAndRestore(); input.blur(); }
                        if (e.key === 'Escape') { freqDisplay.textContent = currentHz + ' Hz'; }
                        e.stopPropagation();
                    });
                    input.addEventListener('blur', commitAndRestore);
                    input.addEventListener('click', (e) => e.stopPropagation());
                });
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        })();
