#!/usr/bin/env python3
"""
Generate handler registration code from handler_map.json
"""

import json

with open('C:\\Users\\User\\Desktop\\IEM-Tool\\handler_map.json', 'r', encoding='utf-8') as f:
    handlers = json.load(f)

print(f"Generating handlers for {len(handlers)} actions")

# Read the transformed HTML to see the action names used
with open('C:\\Users\\User\\Desktop\\IEM-Tool\\index_transformed.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Extract all action names from data-action attributes
import re
action_attrs = re.findall(r'data-action="([^"]+)"', html)
action_inputs = re.findall(r'data-action-input="([^"]+)"', html)
action_changes = re.findall(r'data-action-change="([^"]+)"', html)
action_blurs = re.findall(r'data-action-blur="([^"]+)"', html)
action_keydows = re.findall(r'data-action-keydown="([^"]+)"', html)

all_actions = set(action_attrs + action_inputs + action_changes + action_blurs)

print(f"Found {len(set(action_attrs + action_inputs + action_changes + action_blurs + action_keydows))} unique action names in HTML")

# Group handlers by prefix
click_handlers = {}
input_handlers = {}
change_handlers = {}
blur_handlers = {}
keydown_handlers = {}

for key, action_name in sorted(handlers.items()):
    event_type, handler_code = key.split(':', 1)
    if event_type == 'click':
        click_handlers[action_name] = handler_code
    elif event_type == 'input':
        input_handlers[action_name] = handler_code
    elif event_type == 'change':
        change_handlers[action_name] = handler_code
    elif event_type == 'blur':
        blur_handlers[action_name] = handler_code
    elif event_type == 'keydown':
        keydown_handlers[action_name] = handler_code

# Build output lines
lines = []
lines.append("// Auto-generated handler registration for CSP-compliant event handling")
lines.append("// This file registers all action handlers for the EventBinding system")
lines.append("")
lines.append("(function() {")
lines.append("    const EventBinding = window.EventBinding;")
lines.append("    if (!EventBinding) {")
lines.append("        console.error('[HandlerRegistry] EventBinding not available');")
lines.append("        return;")
lines.append("    }")
lines.append("")
lines.append("    const handlers = {")

# Add all handlers
for action_name, handler_code in sorted(click_handlers.items()):
    lines.append(f'        "{action_name}": function(event, element) {{ {handler_code} }},')

for action_name, handler_code in sorted(input_handlers.items()):
    lines.append(f'        "{action_name}": function(event, element) {{ {handler_code} }},')

for action_name, handler_code in sorted(change_handlers.items()):
    lines.append(f'        "{action_name}": function(event, element) {{ {handler_code} }},')

for action_name, handler_code in sorted(blur_handlers.items()):
    lines.append(f'        "{action_name}": function(event, element) {{ {handler_code} }},')

for action_name, handler_code in sorted(keydown_handlers.items()):
    lines.append(f'        "{action_name}": function(event, element) {{ {handler_code} }},')

lines.append("    };")
lines.append("")
lines.append("    // Register all handlers")
lines.append("    Object.keys(handlers).forEach(function(action) {")
lines.append("        EventBinding.register(action, handlers[action]);")
lines.append("    });")
lines.append("")
lines.append("    console.log('[HandlerRegistry] Registered ' + Object.keys(handlers).length + ' handlers');")
lines.append("})();")

js_code = "\n".join(lines)

with open('C:\\Users\\User\\Desktop\\IEM-Tool\\js\\handlers.js', 'w', encoding='utf-8') as f:
    f.write("\n".join(lines))

total = len(click_handlers) + len(input_handlers) + len(change_handlers) + len(blur_handlers) + len(keydown_handlers)
print(f"Generated handlers.js with {total} handlers")