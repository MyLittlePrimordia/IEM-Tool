#!/usr/bin/env python3
"""
Transform inline event handlers to CSP-compliant data-action attributes.
"""

import re
import sys

def transform_html(content):
    """Transform inline event handlers to data-action attributes."""
    
    # Patterns to match inline event handlers
    # onclick="..." -> data-action="..."
    # oninput="..." -> data-action-input="..."
    # onchange="..." -> data-action-change="..."
    # onblur="..." -> data-action-blur="..."
    # onkeydown="..." -> data-action-keydown="..."
    # onload="..." -> data-action-load="..."
    # etc.
    
    # Handle onclick - the most common
    # Pattern: onclick="CODE" -> data-action="ACTION_NAME" (we'll need to register handlers)
    
    # First, let's identify all unique handler calls
    onclick_pattern = r'onclick\s*=\s*"([^"]*)"'
    oninput_pattern = r'oninput\s*=\s*"([^"]*)"'
    onchange_pattern = r'onchange\s*=\s*"([^"]*)"'
    onblur_pattern = r'onblur\s*=\s*"([^"]*)"'
    onkeydown_pattern = r'onkeydown\s*=\s*"([^"]*)"'
    onload_pattern = r'onload\s*=\s*"([^"]*)"'
    
    # Also look for multiple handlers on same element (e.g., onclick="foo(); bar();")
    
    handlers = {}
    action_counter = 0
    
    def get_action_name(handler_code, prefix="action"):
        nonlocal action_counter
        # Create a normalized action name from the handler code
        # Remove semicolons, parentheses, quotes, etc.
        clean = re.sub(r'[^\w\s]', '_', handler_code)
        clean = re.sub(r'\s+', '_', clean.strip())
        clean = clean.strip('_')
        if not clean:
            clean = prefix
        # Truncate if too long
        if len(clean) > 80:
            clean = clean[:80]
        action_name = f"{prefix}_{action_counter}_{clean}"
        action_counter += 1
        return action_name
    
    # First pass: collect all unique handler codes
    all_handlers = set()
    
    for match in re.finditer(onclick_pattern, content):
        all_handlers.add(('click', match.group(1)))
    
    for match in re.finditer(oninput_pattern, content):
        all_handlers.add(('input', match.group(1)))
    
    for match in re.finditer(onchange_pattern, content):
        all_handlers.add(('change', match.group(1)))
    
    for match in re.finditer(onblur_pattern, content):
        all_handlers.add(('blur', match.group(1)))
    
    for match in re.finditer(onkeydown_pattern, content):
        all_handlers.add(('keydown', match.group(1)))
    
    for match in re.finditer(onload_pattern, content):
        all_handlers.add(('load', match.group(1)))
    
    # Generate action names for each unique handler
    handler_to_action = {}
    for event_type, code in all_handlers:
        action_name = get_action_name(code, event_type)
        handler_to_action[(event_type, code)] = action_name
    
    print(f"Found {len(all_handlers)} unique inline handlers")
    
    # Second pass: replace inline handlers with data-action attributes
    def replace_onclick(match):
        code = match.group(1)
        action = handler_to_action.get(('click', code), 'unknown_click')
        return f'data-action="{action}"'
    
    def replace_oninput(match):
        code = match.group(1)
        action = handler_to_action.get(('input', code), 'unknown_input')
        return f'data-action-input="{action}"'
    
    def replace_onchange(match):
        code = match.group(1)
        action = handler_to_action.get(('change', code), 'unknown_change')
        return f'data-action-change="{action}"'
    
    def replace_onblur(match):
        code = match.group(1)
        action = handler_to_action.get(('blur', code), 'unknown_blur')
        return f'data-action-blur="{action}"'
    
    def replace_onkeydown(match):
        code = match.group(1)
        action = handler_to_action.get(('keydown', code), 'unknown_keydown')
        return f'data-action-keydown="{action}"'
    
    def replace_onload(match):
        code = match.group(1)
        action = handler_to_action.get(('load', code), 'unknown_load')
        return f'data-action-load="{action}"'
    
    content = re.sub(onclick_pattern, replace_onclick, content)
    content = re.sub(oninput_pattern, replace_oninput, content)
    content = re.sub(onchange_pattern, replace_onchange, content)
    content = re.sub(onblur_pattern, replace_onblur, content)
    content = re.sub(onkeydown_pattern, replace_onkeydown, content)
    content = re.sub(onload_pattern, replace_onload, content)
    
    # Also need to handle event.stopPropagation() calls in onclick
    # These are typically in onclick="event.stopPropagation(); OTHER_CODE"
    # The data-action system will handle this via the handler
    
    return content, handler_to_action

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transform_csp.py <input.html> [output.html]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else input_file
    
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    transformed, handlers = transform_html(content)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(transformed)
    
    # Save handler map for reference
    with open('handler_map.json', 'w', encoding='utf-8') as f:
        import json
        json.dump({f"{k[0]}:{k[1]}": v for k, v in handlers.items()}, f, indent=2)
    
    print(f"Transformed HTML written to {output_file}")
    print(f"Handler map written to handler_map.json")

if __name__ == "__main__":
    transform_html(open(sys.argv[1]).read())