#!/usr/bin/env bash
# Purpose: Grep UI source for hard-coded design values that should reference
#          a declared token. Each hit is an investigation candidate, not an
#          automatic finding — the LLM confirms each.
# Usage:   bash scripts/scan-tokens.sh [search-root]
#          Default search-root: src
# Output:  category | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

# Exclusion globs. Kept in sync with references/token-leak-checklist.md.
exclude=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=storybook-static
  --exclude-dir=design-tokens
  --exclude='*.test.*'
  --exclude='*.spec.*'
  --exclude='*.stories.*'
  --exclude='*.snap'
  --exclude='tailwind.config.*'
)

scan() {
  pattern="$1"; category="$2"
  { grep -rEn --binary-files=without-match "${exclude[@]}" "$pattern" "$root" 2>/dev/null || true; } \
    | head -200 \
    | awk -v c="$category" -F: '
        { excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i;
          gsub(/[ \t]+/, " ", excerpt);
          printf "%s | %s:%s | %s\n", c, $1, $2, substr(excerpt,1,160) }'
}

printf 'category | file:line | excerpt\n'

# Hex colors (3 or 6 digit). Skip lines defining a token (`--color-`, `:root`).
scan '#[0-9A-Fa-f]{3,8}\b' 'color-hex'
# rgb()/rgba()/hsl()/hsla() literals
scan '\b(rgb|rgba|hsl|hsla)\s*\(' 'color-functional'
# Tailwind arbitrary-value color brackets
scan '\b(bg|text|border|ring|from|to|via)-\[#' 'tailwind-arbitrary-color'
# Raw px in style attributes / CSS-in-JS values (skip 0px and 1px which are often borders)
scan '[^a-zA-Z0-9_-]([2-9]|[1-9][0-9]+)px\b' 'raw-px'
# Raw rem/em values
scan '[0-9]+(\.[0-9]+)?(rem|em)\b' 'raw-rem-em'
# Inline style attribute
scan 'style=\{\{' 'inline-style'
# !important
scan '!important' 'important-override'
# font-family literal in source files
scan 'font-family[[:space:]]*:[[:space:]]*["'\''"][^"'\'']+["'\'']' 'raw-font-family'
# Named CSS colors that are nearly always leaks (subset; LLM still confirms)
scan '\b(color|background|border|fill|stroke)[a-zA-Z-]*[[:space:]]*:[[:space:]]*(red|blue|green|yellow|orange|purple|pink|cornflowerblue|cyan|magenta|gray|grey)\b' 'named-css-color'
