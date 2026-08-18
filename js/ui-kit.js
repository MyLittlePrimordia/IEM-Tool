/* ===== ui-kit.js =====
 * Small drop-in UI primitives shared across workspaces.
 * Currently: UIKit.confirm() — a themed replacement for window.confirm()
 * that matches the existing modal styling (rename-modal, save-preset-modal,
 * etc.) instead of popping the unstyled native browser dialog.
 *
 * Usage:
 *   const ok = await UIKit.confirm({
 *       title: "Delete this profile?",
 *       message: "This can be undone from the toast that follows.",
 *       confirmLabel: "Delete",
 *       danger: true
 *   });
 *   if (!ok) return;
 */
const UIKit = {
    _modalEl: null,
    _resolver: null,

    _ensureModal: function () {
        if (this._modalEl) return this._modalEl;

        const wrap = document.createElement('div');
        wrap.id = 'uikit-confirm-modal';
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden flex items-center justify-center p-4';
        wrap.innerHTML = `
            <div class="bg-[var(--bg-card)] border border-[var(--border-color)] w-full max-w-sm rounded-lg shadow-2xl flex flex-col overflow-hidden p-4 select-none">
                <div class="flex justify-between items-center mb-3 pb-1.5 border-b border-[var(--border-color)]">
                    <span id="uikit-confirm-title" class="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">⚠️ Confirm</span>
                    <button id="uikit-confirm-x" class="text-zinc-555 hover:text-red-500 text-xs cursor-pointer">❌</button>
                </div>
                <p id="uikit-confirm-msg" class="text-[10px] text-zinc-500 mb-4 leading-normal"></p>
                <div class="grid grid-cols-2 gap-2">
                    <button id="uikit-confirm-cancel" class="py-2 text-xs font-bold rounded btn-clear cursor-pointer">Cancel</button>
                    <button id="uikit-confirm-ok" class="py-2 text-xs font-bold rounded hover:brightness-110 text-white transition-all cursor-pointer text-center"></button>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        const finish = (result) => {
            wrap.classList.add('hidden');
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }
            const resolve = this._resolver;
            this._resolver = null;
            if (resolve) resolve(result);
        };

        wrap.querySelector('#uikit-confirm-x').onclick = () => finish(false);
        wrap.querySelector('#uikit-confirm-cancel').onclick = () => finish(false);
        wrap.querySelector('#uikit-confirm-ok').onclick = () => finish(true);
        // Click on the dark backdrop (not the card itself) cancels, matching
        // the rest of the app's modal behavior.
        wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(false); });
        // Esc cancels, Enter confirms — only while this modal is the one
        // showing, and never while typing inside an input (keeps Enter from
        // confirming the dialog mid-typing).
        this._keyHandler = (e) => {
            if (wrap.classList.contains('hidden')) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'Escape') finish(false);
            else if (e.key === 'Enter') finish(true);
        };
        document.addEventListener('keydown', this._keyHandler);

        this._modalEl = wrap;
        return wrap;
    },

    confirm: function (opts) {
        opts = opts || {};
        const wrap = this._ensureModal();
        const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        wrap.querySelector('#uikit-confirm-title').innerHTML = (opts.icon || (opts.danger ? '🗑️' : '⚠️')) + ' ' + esc(opts.title || 'Are you sure?');
        wrap.querySelector('#uikit-confirm-msg').textContent = opts.message || '';
        const okBtn = wrap.querySelector('#uikit-confirm-ok');
        okBtn.textContent = opts.confirmLabel || 'Confirm';
        okBtn.className = 'py-2 text-xs font-bold rounded hover:brightness-110 text-white transition-all cursor-pointer text-center ' +
            (opts.danger ? 'bg-red-600' : 'bg-[var(--accent-blue)]');

        wrap.classList.remove('hidden');
        wrap.classList.add('flex');

        return new Promise((resolve) => {
            // If a previous confirm() is somehow still pending, resolve it false
            // rather than losing/overwriting its promise silently.
            if (this._resolver) this._resolver(false);
            this._resolver = resolve;
        });
    }
};

if (typeof window !== 'undefined') window.UIKit = UIKit;
