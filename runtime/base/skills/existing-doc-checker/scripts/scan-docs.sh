#!/usr/bin/env bash
# Purpose: Scan canonical doc surfaces for files matching one or more keywords.
# Usage:   bash scripts/scan-docs.sh <keyword> [<keyword> ...]
# Output:  "<path>\t<matched-keyword>" per line, sorted unique.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <keyword> ...\n' "$0" >&2; exit 2; }

# Scan canonical doc surfaces only.
roots=""
for r in docs/instructions docs/modules docs/business docs/maintainers .paqad/indexes; do
  [ -d "$r" ] && roots="$roots $r"
done
[ -n "$roots" ] || exit 0

for kw in "$@"; do
  pattern=$(printf '%s' "$kw" | sed -E 's/[][()|?+*^$.\\]/\\&/g')
  { grep -rlEi --include='*.md' --include='*.json' "$pattern" $roots 2>/dev/null || true; } \
    | while IFS= read -r p; do printf '%s\t%s\n' "$p" "$kw"; done
done | sort -u
