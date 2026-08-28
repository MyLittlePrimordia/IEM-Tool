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