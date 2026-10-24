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
        // No `flex` here: visibility is driven by adding/removing 'flex' together
        // with 'hidden'. Shipping both made the dialog's visibility depend on
        // which utility happened to come last in the generated stylesheet (see
        // the same fix in shortcuts.js).
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden items-center justify-center p-4';
        // Announced as a modal dialog, and labelled by its own title.
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-labelledby', 'uikit-confirm-title');
        wrap.innerHTML = `
            <div id="uikit-confirm-card" class="bg-[var(--bg-card)] border border-[var(--line)] w-full max-w-sm flex flex-col overflow-hidden p-5 select-none" style="border-radius: var(--r-xl); box-shadow: var(--sh-3);">
                <div class="flex justify-between items-center mb-3 pb-3 border-b border-[var(--line)]">
                    <span id="uikit-confirm-title" class="type-md font-semibold uppercase tracking-wide flex items-center gap-2" style="color: var(--text-hi);">⚠️ Confirm</span>
                    <button id="uikit-confirm-x" class="app-caption-btn" style="width:28px;height:28px;" aria-label="Cancel">✕</button>
                </div>
                <p id="uikit-confirm-msg" class="type-sm mb-4 leading-relaxed" style="color: var(--text-mid); white-space: pre-line;"></p>
                <div id="uikit-confirm-details" class="type-xs mb-4 overflow-y-auto hidden" style="max-height:190px;padding:6px 8px;background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-xs);user-select:text;"></div>
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
        // A detail row can carry an id, and the caller an onDetailClick handler:
        // clicking the row closes the dialog exactly like Cancel (nothing is
        // written) and then hands the id back so the caller can navigate to it.
        // Delegated once, so a long list does not bind a listener per row.
        wrap.querySelector('#uikit-confirm-details').addEventListener('click', (e) => {
            const row = e.target && e.target.closest ? e.target.closest('[data-detail-id]') : null;
            if (!row) return;
            const id = row.getAttribute('data-detail-id');
            const fn = this._detailHandler;
            this._finish(false, wrap);
            if (typeof fn !== 'function') return;
            try { fn(id); } catch (err) { console.error('[UIKit] detail click handler failed', err); }
        });
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
            if (e.key === 'Tab') {
                // Focus trap: Tab cycles inside the dialog instead of walking
                // into the page behind the overlay.
                const focusables = Array.from(wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                    .filter((el) => !el.disabled && el.offsetParent !== null);
                if (!focusables.length) { e.preventDefault(); return; }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                return;
            }
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'Escape') self._finish(false, wrap);
            else if (e.key === 'Enter') self._finish(true, wrap);
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    _finish: function (result, wrap) {
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        // Return focus to whatever opened the dialog, so keyboard users do not
        // land back at the top of the document.
        // Per-dialog state must not outlive it: a row handler from the last
        // dialog must never fire for the next one.
        this._detailHandler = null;
        const last = this._lastFocus;
        this._lastFocus = null;
        if (last && typeof last.focus === 'function' && last.isConnected) {
            try { last.focus(); } catch (_) {}
        }
        const resolve = this._resolver;
        this._resolver = null;
        if (resolve) resolve(result);
    },

    confirm: function (opts) {
        opts = opts || {};
        const wrap = this._ensureModal();

        wrap.querySelector('#uikit-confirm-title').innerHTML = (opts.icon || (opts.danger ? '🗑️' : '⚠️')) + ' ' + esc(opts.title || 'Are you sure?');
        wrap.querySelector('#uikit-confirm-msg').textContent = opts.message || '';
        // Optional detail list: a scrollable, colour-coded run of rows (a save
        // preview lists the entries it is about to add, edit and remove). Kept
        // out of the message so long lists scroll instead of stretching the
        // dialog past the viewport.
        const rows = Array.isArray(opts.details) ? opts.details : [];
        const onDetail = typeof opts.onDetailClick === 'function' ? opts.onDetailClick : null;
        this._detailHandler = onDetail;
        const listEl = wrap.querySelector('#uikit-confirm-details');
        if (listEl) {
            if (rows.length) {
                listEl.innerHTML = rows.map(function (r) {
                    const item = typeof r === 'string' ? { text: r } : (r || {});
                    const color = item.kind === 'add' ? 'var(--accent)'
                        : (item.kind === 'del' || item.kind === 'warn') ? 'var(--danger)'
                        : item.kind === 'muted' ? 'var(--text-secondary)'
                        : 'var(--text-main)';
                    const style = 'padding:1px 0;word-break:break-word;color:' + color;
                    const body = esc(item.text || '');
                    // A row with an id and a handler becomes a real button, so
                    // it is reachable with Tab and Enter inside the focus trap.
                    if (onDetail && item.id !== undefined && item.id !== null && item.id !== '') {
                        return '<button type="button" class="uikit-detail-row" data-detail-id="' + esc(String(item.id)) + '" title="Show this entry" style="' + style + '">' + body + '</button>';
                    }
                    return '<div style="' + style + '">' + body + '</div>';
                }).join('');
                listEl.classList.remove('hidden');
            } else {
                listEl.innerHTML = '';
                listEl.classList.add('hidden');
            }
        }
        // Wide enough for entry names only when there is a list to fit.
        const card = wrap.querySelector('#uikit-confirm-card');
        if (card) { card.classList.toggle('max-w-md', rows.length > 0); card.classList.toggle('max-w-sm', rows.length === 0); }
        const okBtn = wrap.querySelector('#uikit-confirm-ok');
        okBtn.textContent = opts.confirmLabel || 'Confirm';
        // Primary action carries the accent halo; a destructive one gets the
        // danger token. Both labels use --accent-ink: white on --danger is
        // 2.77:1, which fails AA at 13px, while the near-black ink on the same
        // red is 7.15:1 - and it keeps filled buttons reading as one family.
        okBtn.style.background = opts.danger
            ? 'var(--danger)'
            : 'var(--accent)';
        okBtn.style.color = 'var(--accent-ink)';

        this._lastFocus = document.activeElement;
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
        this._attachKeyHandler(wrap);
        // Focus the safe action by default: Enter on a destructive dialog must
        // not confirm it. The dialog's buttons are reachable with Tab.
        const initial = opts.danger
            ? wrap.querySelector('#uikit-confirm-cancel')
            : wrap.querySelector('#uikit-confirm-ok');
        try { if (initial) initial.focus(); } catch (_) {}

        return new Promise((resolve) => {
            // If a previous confirm() is somehow still pending, resolve it false
            // rather than losing/overwriting its promise silently.
            if (this._resolver) this._resolver(false);
            this._resolver = resolve;
        });
    },

    /* --- Read-only viewer -------------------------------------------------
     * A modal for text the app can only read, so a document (the save-log
     * changelog) can be read without leaving the app or waiting for an export.
     * Deliberately not confirm(): that one is a question with a promise, this
     * one is a document. Same overlay, focus trap, Esc and backdrop behaviour,
     * plus a scrollable body whose text can be selected and copied, and an
     * optional row of caller-supplied actions beside Close.
     *
     *   UIKit.read({ title, subtitle, text, actions: [{ label, title, onClick }] });
     *   UIKit.read({ title, subtitle, render: (body) => { body.innerHTML = html; } });
     *   UIKit.read({ title, subtitle, toolbar: (bar) => {...}, render: ... });
     *
     * `text` prints verbatim in a <pre>. `render` gets an empty body element and
     * fills it with structure (the save log draws one section per save) - the
     * primitive stays Markdown-agnostic, and the caller owns escaping. `toolbar`
     * gets a bar between the header and the body that is built once per open
     * and is not part of the body, so a control can re-render the body without
     * losing its own focus.
     */
    _readerEl: null,
    _readerKey: null,
    _readerFocus: null,

    _ensureReader: function () {
        if (this._readerEl) return this._readerEl;

        const wrap = document.createElement('div');
        wrap.id = 'uikit-reader';
        // As in _ensureModal: `hidden` only, and `flex` added on show, so the
        // dialog's visibility never depends on stylesheet order.
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden items-center justify-center p-4';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-labelledby', 'uikit-reader-title');
        wrap.innerHTML = `
            <div id="uikit-reader-card" class="bg-[var(--bg-card)] border border-[var(--line)] w-full max-w-2xl flex flex-col overflow-hidden p-5" style="border-radius: var(--r-xl); box-shadow: var(--sh-3); max-height: calc(100vh - 32px);">
                <div class="flex justify-between items-start gap-3 mb-3 pb-3 border-b border-[var(--line)]">
                    <span class="min-w-0">
                        <span id="uikit-reader-title" class="block type-md font-semibold tracking-wide truncate" style="color: var(--text-hi);"></span>
                        <span id="uikit-reader-sub" class="block type-xs mt-0.5" style="color: var(--text-mid);"></span>
                    </span>
                    <button id="uikit-reader-x" type="button" class="app-caption-btn" style="width:28px;height:28px;flex:none;" aria-label="Close">✕</button>
                </div>
                <div id="uikit-reader-tools" class="flex flex-wrap items-center gap-2 mb-2" style="display:none;"></div>
                <div id="uikit-reader-body" style="padding:10px 12px;background:var(--bg-input);border:1px solid var(--line);border-radius:var(--r-xs);user-select:text;overflow:auto;flex:1 1 auto;min-height:120px;"></div>
                <div id="uikit-reader-actions" class="flex justify-end gap-2 mt-4"></div>
            </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector('#uikit-reader-x').onclick = () => this.closeReader();
        wrap.addEventListener('click', (e) => { if (e.target === wrap) this.closeReader(); });

        this._readerEl = wrap;
        return wrap;
    },

    _attachReaderKeys: function (wrap) {
        if (this._readerKey) {
            document.removeEventListener('keydown', this._readerKey);
            this._readerKey = null;
        }
        const self = this;
        this._readerKey = (e) => {
            if (wrap.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                // Esc inside a field is the browser's own "clear this", and the
                // reader's toolbar has a search box: closing the document while
                // someone is typing in it would be hostile.
                const tag = (e.target && e.target.tagName) || '';
                if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
                e.preventDefault(); self.closeReader(); return;
            }
            if (e.key !== 'Tab') return;
            // Same focus trap as confirm(): Tab cycles inside the dialog
            // instead of walking into the page behind the overlay.
            const focusables = Array.from(wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                .filter((el) => !el.disabled && el.offsetParent !== null);
            if (!focusables.length) { e.preventDefault(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', this._readerKey);
    },

    read: function (opts) {
        opts = opts || {};
        const wrap = this._ensureReader();
        wrap.querySelector('#uikit-reader-title').textContent = opts.title || 'Read-only view';
        const sub = wrap.querySelector('#uikit-reader-sub');
        sub.textContent = opts.subtitle || '';
        sub.style.display = opts.subtitle ? 'block' : 'none';
        const tools = wrap.querySelector('#uikit-reader-tools');
        tools.innerHTML = '';
        tools.style.display = typeof opts.toolbar === 'function' ? 'flex' : 'none';
        if (typeof opts.toolbar === 'function') opts.toolbar(tools);

        const body = wrap.querySelector('#uikit-reader-body');
        body.innerHTML = '';
        body.scrollTop = 0;
        if (typeof opts.render === 'function') {
            opts.render(body);
        } else {
            const pre = document.createElement('pre');
            pre.id = 'uikit-reader-text';
            // Monospace lives on the text itself rather than the body, so a
            // structured document is not forced into a code font.
            pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;user-select:text;' +
                'font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:var(--t-xs);line-height:1.6;';
            pre.textContent = opts.text === undefined || opts.text === null ? '' : String(opts.text);
            body.appendChild(pre);
        }

        // Actions are rebuilt per call: a handler from the previous document
        // must never be reachable from this one.
        const bar = wrap.querySelector('#uikit-reader-actions');
        bar.innerHTML = '';
        (Array.isArray(opts.actions) ? opts.actions : []).forEach((a) => {
            if (!a || !a.label) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-clear cursor-pointer';
            btn.style.cssText = 'height:34px;padding:0 14px;border-radius: var(--r-md);font-size:var(--t-sm);';
            btn.textContent = a.label;
            if (a.title) btn.title = a.title;
            btn.onclick = () => { try { a.onClick(); } catch (err) { console.error('[UIKit] reader action failed', err); } };
            bar.appendChild(btn);
        });
        const close = document.createElement('button');
        close.id = 'uikit-reader-close';
        close.type = 'button';
        close.className = 'font-semibold cursor-pointer';
        close.style.cssText = 'height:34px;padding:0 16px;border-radius: var(--r-md);font-size:var(--t-sm);background:var(--accent);color:var(--accent-ink);';
        close.textContent = opts.closeLabel || 'Close';
        close.onclick = () => this.closeReader();
        bar.appendChild(close);

        this._readerFocus = document.activeElement;
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
        this._attachReaderKeys(wrap);
        try { close.focus(); } catch (_) {}
        return wrap;
    },

    closeReader: function () {
        const wrap = this._readerEl;
        if (!wrap) return;
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
        if (this._readerKey) {
            document.removeEventListener('keydown', this._readerKey);
            this._readerKey = null;
        }
        // Back to whatever opened the document, so keyboard users do not land
        // at the top of the page.
        const last = this._readerFocus;
        this._readerFocus = null;
        if (last && typeof last.focus === 'function' && last.isConnected) {
            try { last.focus(); } catch (_) {}
        }
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
        // Async IPC (the old sendSync blocked the renderer during boot). Paint
        // the default glyph now, then adopt the real state when it resolves.
        applyMaxFrame(false);
        Promise.resolve(bridge.windowIsMaximized()).then(applyMaxFrame).catch(() => {});

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
