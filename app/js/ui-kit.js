/* ===== app/js/ui-kit.js =====
 * Small drop-in UI primitives shared across workspaces.
 *   UIKit.confirm(opts)  — themed replacement for window.confirm()
 *   UIKit.windowChrome()  — R1 custom caption bar (minimise / maximize / close)
 *
 * The window became frameless in R1 so the app could draw its own title bar
 * with rounded corners and Windows-convention red / amber / green buttons, which
 * means the renderer owns three operations that used to be free. They are
 * routed through preload.js, which exposes exactly three named commands and no
 * generic IPC passthrough.
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
    _chromeBound: false,

    _ensureModal: function () {
        if (this._modalEl) return this._modalEl;

        const wrap = document.createElement('div');
        wrap.id = 'uikit-confirm-modal';
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden flex items-center justify-center p-4';
        wrap.innerHTML = `
            <div class="bg-[var(--bg-card)] border border-[var(--line)] w-full max-w-sm flex flex-col overflow-hidden p-5 select-none" style="border-radius: var(--r-xl); box-shadow: var(--sh-3);">
                <div class="flex justify-between items-center mb-3 pb-3 border-b border-[var(--line)]">
                    <span id="uikit-confirm-title" class="text-[13px] font-semibold uppercase tracking-wide flex items-center gap-2" style="color: var(--text-hi);">⚠️ Confirm</span>
                    <button id="uikit-confirm-x" class="app-caption-btn" style="width:28px;height:28px;" aria-label="Cancel">✕</button>
                </div>
                <p id="uikit-confirm-msg" class="text-[12px] mb-4 leading-relaxed" style="color: var(--text-mid);"></p>
                <div class="grid grid-cols-2 gap-2">
                    <button id="uikit-confirm-cancel" class="btn-clear cursor-pointer" style="height:36px;border-radius: var(--r-md);">Cancel</button>
                    <button id="uikit-confirm-ok" class="font-semibold text-white transition-all cursor-pointer text-center" style="height:36px;border-radius: var(--r-md);"></button>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        const finish = (result) => {
            this._finish(result, wrap);
        };

        wrap.querySelector('#uikit-confirm-x').onclick = () => finish(false);
        wrap.querySelector('#uikit-confirm-cancel').onclick = () => finish(false);
        wrap.querySelector('#uikit-confirm-ok').onclick = () => finish(true);
        // Click on the dark backdrop (not the card itself) cancels, matching
        // the rest of the app's modal behavior.
        wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(false); });
        // Esc cancels, Enter confirms — only while this modal is the one
        // showing, and never while typing inside an input (keeps Enter from
        // confirming the dialog mid-typing). Attached via _attachKeyHandler
        // so every confirm() re-binds it (finish() removes it per dialog).
        this._attachKeyHandler(wrap);

        this._modalEl = wrap;
        return wrap;
    },

    // Shared per-dialog keydown handler: attached on every confirm() and
    // removed by _finish(), so a stale handler never survives a dismissed
    // dialog and a reopened one always responds to Esc/Enter.
    _attachKeyHandler: function (wrap) {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        const self = this;
        this._keyHandler = (e) => {
            if (wrap.classList.contains('hidden')) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'Escape') self._finish(false, wrap);
            else if (e.key === 'Enter') self._finish(true, wrap);
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    _finish: function (result, wrap) {
        wrap.classList.add('hidden');
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        const resolve = this._resolver;
        this._resolver = null;
        if (resolve) resolve(result);
    },

    confirm: function (opts) {
        opts = opts || {};
        const wrap = this._ensureModal();
        const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        wrap.querySelector('#uikit-confirm-title').innerHTML = (opts.icon || (opts.danger ? '🗑️' : '⚠️')) + ' ' + esc(opts.title || 'Are you sure?');
        wrap.querySelector('#uikit-confirm-msg').textContent = opts.message || '';
        const okBtn = wrap.querySelector('#uikit-confirm-ok');
        okBtn.textContent = opts.confirmLabel || 'Confirm';
        // Primary action carries the accent halo; a destructive one gets the
        // danger token. Both use --accent-ink / #fff for the label.
        okBtn.style.background = opts.danger
            ? 'var(--danger)'
            : 'var(--accent)';
        okBtn.style.color = opts.danger ? '#FFFFFF' : 'var(--accent-ink)';

        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
        this._attachKeyHandler(wrap);

        return new Promise((resolve) => {
            // If a previous confirm() is somehow still pending, resolve it false
            // rather than losing/overwriting its promise silently.
            if (this._resolver) this._resolver(false);
            this._resolver = resolve;
        });
    },

    /* --- R1: window caption bar ------------------------------------------
     * Binds minimise / maximise / close and keeps the maximise glyph in sync
     * with the real window state, so double-clicking the title bar or using
     * Win+Up also updates the button.
     *
     * A no-op outside Electron (the tools/ screenshot harness runs the page in a
     * plain BrowserWindow with no preload), which is why every call is guarded.
     * Idempotent: safe to call on every boot. */
    windowChrome: function () {
        if (this._chromeBound) return;
        const bridge = window.appBridge;
        if (!bridge || !bridge.windowMinimize) return;

        const minBtn = document.getElementById('win-minimize');
        const maxBtn = document.getElementById('win-maximize');
        const closeBtn = document.getElementById('win-close');

        const setMaxGlyph = (isMax) => {
            if (!maxBtn) return;
            maxBtn.title = isMax ? 'Restore' : 'Maximize';
            maxBtn.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
            // Restore = two overlapping squares; Maximize = one square.
            maxBtn.innerHTML = isMax
                ? '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5H9.5V7.5H7.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
                : '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
        };

        if (minBtn) minBtn.addEventListener('click', () => bridge.windowMinimize());
        if (maxBtn) maxBtn.addEventListener('click', () => bridge.windowToggleMaximize());
        if (closeBtn) closeBtn.addEventListener('click', () => bridge.windowClose());

        // A maximized window draws square corners on Windows, so the caption
        // cluster is inset rather than hard against the frame while maximized.
        const applyMaxFrame = (isMax) => {
            setMaxGlyph(isMax);
            document.documentElement.classList.toggle('win-maximized', !!isMax);
        };
        applyMaxFrame(bridge.windowIsMaximized());

        // main.js pushes this on maximize / unmaximize, which also covers
        // double-click on the drag region and Win+Up / Win+Down. Subscribing
        // (rather than polling) means zero cost when the state never changes.
        if (typeof bridge.onWindowStateChanged === 'function') {
            bridge.onWindowStateChanged(applyMaxFrame);
        }

        this._chromeBound = true;
    }
};

if (typeof window !== 'undefined') window.UIKit = UIKit;
