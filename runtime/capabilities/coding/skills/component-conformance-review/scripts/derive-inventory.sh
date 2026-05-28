#!/usr/bin/env bash
# Purpose: Derive the AST-ish component inventory from src/components/** —
#          one row per component file. The inventory is the SUBJECT of the
#          audit; components.md is the CONTRACT. The LLM compares the two.
#
# Usage:   bash scripts/derive-inventory.sh [components-dir]
#          Default components-dir: src/components
#
# Output:  one TSV row per component to stdout:
#            <name>\t<source-file>
#          where <name> is the component file's basename without extension.
#          Diagnostics to stderr.
#
# Filters:
#   - skips `*.test.*`, `*.spec.*`, `*.stories.*`, `*.d.ts`
#   - skips files that don't begin with an uppercase letter (likely helpers)
#   - skips `index.{ts,tsx,js,jsx}` (re-export barrels)
#
# Exits:   0 ok (including empty dir or missing dir -> empty output)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src/components}"
if [ ! -d "$root" ]; then
  printf 'note: components dir not found: %s\n' "$root" >&2
  exit 0
fi

# Find component files. Exclude tests / stories / barrels / .d.ts.
find "$root" -type f \( \
  -name '*.tsx' -o -name '*.jsx' -o -name '*.ts' -o -name '*.js' \
\) \
  ! -name '*.test.*' \
  ! -name '*.spec.*' \
  ! -name '*.stories.*' \
  ! -name '*.d.ts' \
  ! -name 'index.tsx' ! -name 'index.ts' \
  ! -name 'index.jsx' ! -name 'index.js' 2>/dev/null \
  | sort \
  | while IFS= read -r f; do
      base=$(basename "$f")
      name="${base%.*}"
      # Component names start with uppercase. Reject lower-case helpers.
      first="${name:0:1}"
      case "$first" in
        [A-Z]) printf '%s\t%s\n' "$name" "$f" ;;
        *) printf 'note: skipping non-component file: %s\n' "$f" >&2 ;;
      esac
    done
