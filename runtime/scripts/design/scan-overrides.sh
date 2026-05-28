#!/usr/bin/env bash
# Purpose: Scan UI source for override sprawl — !important, inline style=,
#          arbitrary-value Tailwind brackets, undocumented utility combos.
# Usage:   bash runtime/scripts/design/scan-overrides.sh [search-root] [--out <path>]
# Output:  category | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
out=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

exclude=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=storybook-static
  --exclude='*.test.*'
  --exclude='*.spec.*'
  --exclude='*.stories.*'
  --exclude='*.snap'
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

emit() {
  printf 'category | file:line | excerpt\n'
  scan '!important' 'important-override'
  scan 'style=\{\{' 'inline-style-jsx'
  scan 'style="[^"]+"' 'inline-style-html'
  scan '\b(bg|text|border|ring|p|m|gap|w|h|min-w|max-w|min-h|max-h|rounded|shadow)-\[' 'tailwind-arbitrary'
  scan 'className="[^"]*\b(bg|text)-\w+-(50|100|200|300|400|500|600|700|800|900)\b[^"]*\b(bg|text)-\w+-(50|100|200|300|400|500|600|700|800|900)\b' 'tailwind-color-pair-on-one-element'
}

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  emit > "$out"
  printf 'wrote %s\n' "$out"
else
  emit
fi
