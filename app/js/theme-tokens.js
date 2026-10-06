// The nine built-in themes, extracted verbatim from iem-module.js.
//
// This lives in its own file for ONE reason: App.setGlobalTheme() applies each
// theme by writing `theme.variables` as INLINE custom properties on <html>. The
// `.theme-*` blocks in app.css only supply the backdrop pattern (--tp) and a
// set of accents that went stale when the accents were retuned - slate's is
// still #5AA9E6 (light blue) even though the theme is named Black.
//
// Anything that needs the real per-theme tokens must therefore use THIS map,
// not the CSS classes. app/export-backdrop.html does exactly that, which is why
// the exported review card no longer comes out in the wrong colour.
//
// Keep the values here byte-identical to what the app applies. One copy, two
// consumers: that is the whole point.
const IEM_BUILTIN_THEMES = [
            { "id": "slate", "name": "Black", "emoji": "\u{26AB}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#A3A3AB", "--accent-blue-rgb": "163, 163, 171", "--accent": "#A3A3AB", "--accent-hi": "#D4D4D8", "--accent-rgb": "163, 163, 171" } },
            { "id": "parchment", "name": "Brown", "emoji": "\u{1F7EB}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#B07C50", "--accent-blue-rgb": "176, 124, 80", "--accent": "#B07C50", "--accent-hi": "#D9A066", "--accent-rgb": "176, 124, 80" } },
            { "id": "ember", "name": "Red", "emoji": "\u{1F534}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#EF4444", "--accent-blue-rgb": "239, 68, 68", "--accent": "#EF4444", "--accent-hi": "#F87171", "--accent-rgb": "239, 68, 68" } },
            { "id": "circuit", "name": "Blue", "emoji": "\u{1F535}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#60A5FA", "--accent-blue-rgb": "96, 165, 250", "--accent": "#60A5FA", "--accent-hi": "#93C5FD", "--accent-rgb": "96, 165, 250" } },
            { "id": "byte", "name": "Green", "emoji": "\u{1F7E2}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#34D399", "--accent-blue-rgb": "52, 211, 153", "--accent": "#34D399", "--accent-hi": "#6EE7B7", "--accent-rgb": "52, 211, 153" } },
            { "id": "cartridge", "name": "Yellow", "emoji": "\u{1F7E1}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#FBBF24", "--accent-blue-rgb": "251, 191, 36", "--accent": "#FBBF24", "--accent-hi": "#FCD34D", "--accent-rgb": "251, 191, 36" } },
            { "id": "arcade", "name": "Purple", "emoji": "\u{1F7E3}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#A78BFA", "--accent-blue-rgb": "167, 139, 250", "--accent": "#A78BFA", "--accent-hi": "#C4B5FD", "--accent-rgb": "167, 139, 250" } },
            { "id": "blush", "name": "Pink", "emoji": "\u{1F338}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#F472B6", "--accent-blue-rgb": "244, 114, 182", "--accent": "#F472B6", "--accent-hi": "#F9A8D4", "--accent-rgb": "244, 114, 182" } },
            { "id": "bit", "name": "Orange", "emoji": "\u{1F7E0}", "variables": { "--bg-body": "#000000", "--bg-window": "#0A0A0B", "--bg-card": "#0A0A0B", "--bg-sidebar": "#050506", "--bg-input": "#0E0E11", "--text-main": "#F2F3F5", "--text-secondary": "#9CA3AF", "--border-color": "#212126", "--accent-blue": "#FB923C", "--accent-blue-rgb": "251, 146, 60", "--accent": "#FB923C", "--accent-hi": "#FDBA74", "--accent-rgb": "251, 146, 60" } }
        ];
