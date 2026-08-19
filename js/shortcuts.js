/* ===== shortcuts.js =====
 * App-wide keyboard shortcuts + a discoverable cheat-sheet modal.
 * Bindings are intentionally conservative (workspace switching, playback,
 * export, help) so they never fight with typing in an input, a slider drag,
 * or a canvas gesture.
 *
 * Open the cheat sheet any time with "?" (Shift+/) or the floating help
 * button injected in the bottom-right corner.
 */
const Shortcuts = {
    _modalEl: null,
    _fabEl: null,

    // Each entry: key (as reported by e.key, lowercase), label, group, action.
    _bindings: [
        { key: '1', label: 'Switch to Find', group: 'Workspace', action: () => App.switchTab('find') },
        { key: '2', label: 'Switch to EQ', group: 'Workspace', action: () => App.switchTab('eq') },
        { key: '3', label: 'Switch to Test Lab', group: 'Workspace', action: () => App.switchTab('testlab') },
        { key: '4', label: 'Switch to Review', group: 'Workspace', action: () => App.switchTab('iem') },
        { key: '5', label: 'Switch to Visualizer', group: 'Workspace', action: () => App.switchTab('visualizer') },
        { key: '6', label: 'Switch to Settings', group: 'Workspace', action: () => App.switchTab('settings') },
        { key: ' ', displayKey: 'Space', label: 'Play / Pause', group: 'Playback', action: () => { if (typeof EQ !== 'undefined' && EQ.togglePlayState) EQ.togglePlayState(); } },
        { key: 'e', ctrl: true, label: 'Export EQ Profile', group: 'EQ', action: () => { if (typeof EQ !== 'undefined' && EQ.showExportModal) EQ.showExportModal(); } },
        { key: '?', label: 'Show this shortcuts list', group: 'General', action: () => Shortcuts.toggleHelp() },
        { key: 'escape', label: 'Close open modal', group: 'General', action: null } // handled natively by each modal; listed for discoverability only
    ],

    _isTypingTarget: function (el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    },

    _handleKeydown: function (e) {
        // Respect handlers that already consumed the event (e.g. a modal).
        if (e.defaultPrevented) return;
        if (Shortcuts._isTypingTarget(e.target)) return;
        // Don't hijack keys while an interactive control (button, link) has
        // focus: Space would otherwise both activate the control (native
        // behavior) and trigger the playback binding.
        const el = e.target;
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || (el.getAttribute && el.getAttribute('role') === 'button'))) return;
        const key = e.key.toLowerCase();
        const match = Shortcuts._bindings.find(b => {
            if (!b.action) return false;
            const bKey = (b.key || '').toLowerCase();
            const ctrlOk = !!b.ctrl === (e.ctrlKey || e.metaKey);
            return bKey === key && ctrlOk;
        });
        if (!match) return;
        e.preventDefault();
        try { match.action(); } catch (err) { console.error('[Shortcuts]', err); }
    },

    _ensureHelpModal: function () {
        if (this._modalEl) return this._modalEl;

        const groups = {};
        this._bindings.forEach(b => {
            if (!groups[b.group]) groups[b.group] = [];
            groups[b.group].push(b);
        });

        const keyChip = (b) => `<span class="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 border border-[var(--border-color)] rounded bg-[var(--bg-input)] text-[10px] font-mono font-bold">${b.ctrl ? 'Ctrl+' : ''}${b.displayKey || b.key.toUpperCase()}</span>`;

        let groupsHtml = '';
        Object.keys(groups).forEach(g => {
            groupsHtml += `<div class="mb-3"><p class="text-[9px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">${g}</p><div class="space-y-1.5">`;
            groups[g].forEach(b => {
                groupsHtml += `<div class="flex items-center justify-between gap-3"><span class="text-[11px] text-[var(--text-main)]">${b.label}</span>${keyChip(b)}</div>`;
            });
            groupsHtml += `</div></div>`;
        });

        const wrap = document.createElement('div');
        wrap.id = 'shortcuts-help-modal';
        wrap.className = 'fixed inset-0 bg-black/85 backdrop-blur-sm z-[300] hidden flex items-center justify-center p-4';
        wrap.innerHTML = `
            <div class="bg-[var(--bg-card)] border border-[var(--border-color)] w-full max-w-sm rounded-lg shadow-2xl flex flex-col overflow-hidden p-4 select-none max-h-[85vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-3 pb-1.5 border-b border-[var(--border-color)]">
                    <span class="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">⌨️ Keyboard Shortcuts</span>
                    <button id="shortcuts-help-close" class="text-zinc-555 hover:text-red-500 text-xs cursor-pointer">❌</button>
                </div>
                ${groupsHtml}
                <p class="text-[9px] text-zinc-600 mt-1 leading-normal">Shortcuts are disabled while typing in a text field.</p>
            </div>`;
        document.body.appendChild(wrap);

        const close = () => wrap.classList.add('hidden');
        wrap.querySelector('#shortcuts-help-close').onclick = close;
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

        this._modalEl = wrap;
        return wrap;
    },

    _ensureFab: function () {
        if (this._fabEl) return;
        const btn = document.createElement('button');
        btn.id = 'shortcuts-help-fab';
        btn.title = 'Keyboard shortcuts (?)';
        btn.className = 'fixed bottom-4 right-4 z-[200] w-8 h-8 rounded-full border-2 border-black bg-[var(--bg-card)] text-[var(--text-main)] shadow-[3px_3px_0_0_#000] text-xs font-black cursor-pointer hover:brightness-110 flex items-center justify-center';
        btn.textContent = '?';
        btn.onclick = () => Shortcuts.toggleHelp();
        document.body.appendChild(btn);
        this._fabEl = btn;
    },

    toggleHelp: function () {
        const modal = this._ensureHelpModal();
        modal.classList.toggle('hidden');
        modal.classList.toggle('flex');
    },

    init: function () {
        document.addEventListener('keydown', Shortcuts._handleKeydown);
        this._ensureFab();
    }
};

if (typeof window !== 'undefined') {
    window.Shortcuts = Shortcuts;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Shortcuts.init());
    } else {
        Shortcuts.init();
    }
}
