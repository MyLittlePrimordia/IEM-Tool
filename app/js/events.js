// Event binding system for CSP-compliant event handling
// Replaces inline onclick/onchange/oninput handlers with data-action attributes

const EventBinding = {
    // Map of action names to handler functions
    handlers: {},

    // Register a handler for an action
    register: function(action, handler) {
        if (typeof handler !== 'function') {
            console.warn('[EventBinding] Handler for "' + action + '" is not a function');
            return;
        }
        this.handlers[action] = handler;
    },

    // Register multiple handlers at once
    registerAll: function(map) {
        Object.keys(map).forEach(function(action) {
            this.register(action, map[action]);
        }, this);
    },

    // Get handler for an action
    get: function(action) {
        return this.handlers[action] || null;
    },

    // Execute an action with optional arguments
    execute: function(action, event, element) {
        const handler = this.get(action);
        if (!handler) {
            console.warn('[EventBinding] No handler registered for action: ' + action);
            return;
        }
        try {
            // Call handler with element as `this` so inline handlers using `this.value`/`this.checked` keep working
            return handler.call(element, event, element);
        } catch (e) {
            console.error('[EventBinding] Error executing action "' + action + '":', e);
        }
    },

    // Initialize event delegation on document
    init: function() {
        if (this._initialized) return;
        this._initialized = true;

        // Helper to get element target (handles text nodes)
        function getEventTarget(event) {
            const target = event.target;
            return (target && typeof target.closest === 'function') ? target : (target && target.parentElement) || document.body;
        }

        // Click delegation
        document.addEventListener('click', function(event) {
            const target = getEventTarget(event).closest('[data-action]');
            if (target) {
                const action = target.getAttribute('data-action');
                const args = target.getAttribute('data-action-args');
                if (action) {
                    const parsedArgs = args ? args.split(',').map(function(a) { return a.trim(); }) : [];
                    EventBinding.execute(action, event, target, parsedArgs);
                }
            }
        }, true);

        // Input/change delegation
        document.addEventListener('input', function(event) {
            const target = getEventTarget(event).closest('[data-action-input]');
            if (target) {
                const action = target.getAttribute('data-action-input');
                if (action) {
                    EventBinding.execute(action, event, target);
                }
            }
        }, true);

        document.addEventListener('change', function(event) {
            const target = getEventTarget(event).closest('[data-action-change]');
            if (target) {
                const action = target.getAttribute('data-action-change');
                if (action) {
                    EventBinding.execute(action, event, target);
                }
            }
        }, true);

        // Blur delegation (for preamp edit commit, etc.)
        document.addEventListener('blur', function(event) {
            const target = getEventTarget(event).closest('[data-action-blur]');
            if (target) {
                const action = target.getAttribute('data-action-blur');
                if (action) {
                    EventBinding.execute(action, event, target);
                }
            }
        }, true);

        // Keydown delegation (for Enter key in inputs)
        document.addEventListener('keydown', function(event) {
            const target = getEventTarget(event).closest('[data-action-keydown]');
            if (target && event.key === 'Enter') {
                const action = target.getAttribute('data-action-keydown');
                if (action) {
                    EventBinding.execute(action, event, target);
                }
            }
        }, true);

        // Focus delegation. `focus` does not bubble, so this relies on the
        // capture flag exactly like the blur delegation above. Migrated from
        // four inline onfocus="..." attributes, which were part of why
        // script-src needed 'unsafe-inline'.
        document.addEventListener('focus', function(event) {
            const target = getEventTarget(event).closest('[data-action-focus]');
            if (target) {
                const action = target.getAttribute('data-action-focus');
                if (action) {
                    EventBinding.execute(action, event, target);
                }
            }
        }, true);

        // Drag-and-drop delegation for the three EQ slot drop targets. Also
        // migrated from inline ondragover/ondragleave/ondrop.
        ['dragover', 'dragleave', 'drop'].forEach(function(name) {
            document.addEventListener(name, function(event) {
                const target = getEventTarget(event).closest('[data-action-' + name + ']');
                if (target) {
                    const action = target.getAttribute('data-action-' + name);
                    if (action) {
                        EventBinding.execute(action, event, target);
                    }
                }
            }, true);
        });

        // Keyboard activation for controls that are only wired to `click` but
        // are not real <button>s: the four <label> wrappers around hidden file
        // inputs, and the Smart Import dropzone div. None of them were focusable
        // or reachable by keyboard (POL-003).
        //
        // Clicking a <label> programmatically does forward activation to the
        // control it wraps, so one code path covers both shapes. Space is
        // preventDefault'd because it would otherwise scroll the page.
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
            const target = getEventTarget(event);
            const trigger = target.closest && target.closest('[data-file-trigger]');
            if (!trigger) return;
            event.preventDefault();
            trigger.click();
        }, true);

        // Generic command dispatch, used by markup that JS builds at runtime.
        //
        // The EQ band cards, the Find pick chips and the PEQdb rows used to be
        // emitted as onclick="EQ.cycleBandType(3)" inside template strings.
        // Attribute-form handlers are exactly what forces
        // script-src 'unsafe-inline', and there are far too many combinations to
        // give each one a key in handlers.js, so the call is expressed as data:
        //
        //   <button data-cmd="EQ.cycleBandType" data-arg-0="3">
        //   <input  data-cmd-input="EQ.handleFreqNumInput" data-arg-0="3" data-arg-1="@value">
        //
        // `@value` reads the element's own value, which is what the old handlers
        // got from `this.value`. Args are coerced (numeric strings to numbers,
        // true/false/null literals) because the target functions compare against
        // numbers.
        //
        // Deliberately no eval: resolving through a string would need
        // 'unsafe-eval', trading one CSP hole for another.
        function coerceArg(raw, el) {
            if (raw === '@value') return el.value;
            if (raw === '@checked') return el.checked;
            if (raw === '@self') return el;
            // @from:<key> reads <key> from the nearest ancestor carrying
            // data-<key>. Replaces the common
            // `this.closest('[data-uid]').dataset.uid` argument.
            if (raw.startsWith('@from:')) {
                const key = raw.slice(6);
                const host = el.closest('[data-' + key + ']');
                return host ? host.dataset[key] : undefined;
            }
            if (raw === 'true') return true;
            if (raw === 'false') return false;
            if (raw === 'null') return null;
            if (raw !== '' && /^-?\d*\.?\d+$/.test(raw)) return Number(raw);
            return raw;
        }

        // The only modules a data-cmd attribute may name, mapped to the global
        // they resolve through.
        //
        // The old lookup was `window[modName] || window[CMD_MODULE_ALIASES[modName]]`,
        // i.e. ANY property of window. A data-cmd attribute could therefore reach
        // every global in the renderer - sessionStorage.clear, localStorage.setItem,
        // history.back, location.assign, document.adoptNode, Notification,
        // postMessage, fetch, Worker. The markup is app-authored today and the CSP
        // (script-src 'self' 'wasm-unsafe-eval', so eval() is blocked) is a genuine
        // second line, but neither fact should be what stands between a DOM
        // attribute and the whole window object. Four modules is the complete set
        // in use: measured across every data-cmd* attribute in a live DOM -
        // EQ 120, FindEngine 60, IEM 733, PEQDB_Module 4715.
        //
        // PEQDB_Module -> PEQDB: iem-module.js init() exposes the PEQdb module as
        // `window.PEQDB`, but the markup names it `PEQDB_Module`. The alias lives
        // here rather than putting PEQDB_Module on window, because several
        // `window.PEQDB_Module && ...` guards elsewhere would change meaning.
        const CMD_MODULES = {
            EQ: 'EQ',
            FindEngine: 'FindEngine',
            IEM: 'IEM',
            PEQDB_Module: 'PEQDB',
        };

        function runCommand(el, attrName) {
            const cmd = el.getAttribute(attrName);
            if (!cmd) return;
            const dot = cmd.indexOf('.');
            if (dot < 0) {
                console.warn('[EventBinding] data-cmd must look like Module.method, got: ' + cmd);
                return;
            }
            // Must be an OWN property. `mod[methodName]` alone also finds the
            // Object.prototype members, and several of those are functions -
            // data-cmd="IEM.constructor" resolved to Object and was callable,
            // which walked straight past the module allowlist above.
            const modName = cmd.slice(0, dot);
            const globalName = Object.prototype.hasOwnProperty.call(CMD_MODULES, modName)
                ? CMD_MODULES[modName]
                : null;
            if (globalName === null) {
                console.warn('[EventBinding] data-cmd names a module that is not allowed: ' + cmd);
                return;
            }
            const mod = window[globalName];
            const methodName = cmd.slice(dot + 1);
            if (!mod || !Object.prototype.hasOwnProperty.call(mod, methodName)) {
                console.warn('[EventBinding] data-cmd target is not a function: ' + cmd);
                return;
            }
            const fn = mod[methodName];
            if (typeof fn !== 'function') {
                console.warn('[EventBinding] data-cmd target is not a function: ' + cmd);
                return;
            }
            const args = [];
            for (let i = 0; ; i++) {
                const v = el.getAttribute('data-arg-' + i);
                if (v === null) break;
                args.push(coerceArg(v, el));
            }
            try {
                // `this` must be the MODULE, not the element. The inline form this
                // replaces was `onclick="EQ.toggleBandBypass(3)"` - a method call on
                // EQ, so `this` inside the function was the module. Binding the
                // element here made those functions fail on `this.updateSlider`
                // and friends. The element is still available for `@value`,
                // which coerceArg reads directly.
                fn.apply(mod, args);
            } catch (e) {
                console.error('[EventBinding] data-cmd "' + cmd + '" threw:', e);
            }
        }

        ['click', 'input', 'change'].forEach(function(name) {
            const attr = 'data-cmd-' + name;
            document.addEventListener(name, function(event) {
                const target = getEventTarget(event);
                if (!target || !target.closest) return;
                const el = target.closest('[' + attr + ']');
                if (el) { runCommand(el, attr); return; }
                if (name === 'click') {
                    // Plain data-cmd is the click shorthand.
                    const plain = target.closest('[data-cmd]');
                    if (plain) {
                        if (plain.hasAttribute('data-action')) {
                            console.warn('[EventBinding] element has both data-cmd and data-action; both would run: #' + (plain.id || '?'));
                        }
                        runCommand(plain, 'data-cmd');
                    }
                }
            }, true);
        });

        // A click that must not bubble, with no call attached. Replaces
        // onclick="event.stopPropagation();" on rows where a child control owns
        // the click but the row itself must not react.
        document.addEventListener('click', function(event) {
            const target = getEventTarget(event);
            if (target && target.closest && target.closest('[data-stop-propagation]')) {
                event.stopPropagation();
            }
        }, true);

        console.log('[EventBinding] Initialized with ' + Object.keys(this.handlers).length + ' handlers');
    }
};

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        EventBinding.init();
    });
} else {
    EventBinding.init();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventBinding;
} else {
    window.EventBinding = EventBinding;
}