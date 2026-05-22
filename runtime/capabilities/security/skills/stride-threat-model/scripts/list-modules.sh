#!/usr/bin/env bash
# Purpose: Enumerate canonical module slugs from docs/modules/ (or module-map.yml).
# Usage:   bash scripts/list-modules.sh
# Output:  Sorted unique module slugs, one per line.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ -d docs/modules ]; then
  for d in docs/modules/*/; do
    [ -d "$d" ] && basename "$d"
  done | sort -u
elif [ -f docs/instructions/rules/module-map.yml ]; then
  { grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' docs/instructions/rules/module-map.yml || true; } \
    | sed -E 's/^([a-z0-9_-]+):.*/\1/' | sort -u
else
  printf 'note: no module source found\n' >&2
fi
