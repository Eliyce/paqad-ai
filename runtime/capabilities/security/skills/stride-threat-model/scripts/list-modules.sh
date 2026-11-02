#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Enumerate canonical module slugs from docs/modules/ (or module-map.yml).
Usage:   bash scripts/list-modules.sh
Output:  Sorted unique module slugs, one per line.
USAGE
  exit 0
fi
if [ -d docs/modules ]; then
  for d in docs/modules/*/; do
    [ -d "$d" ] && basename "$d"
  done | LC_ALL=C sort -u
elif [ -f docs/instructions/rules/module-map.yml ]; then
  { grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' docs/instructions/rules/module-map.yml || true; } \
    | sed -E 's/^([a-z0-9_-]+):.*/\1/' | LC_ALL=C sort -u
else
  printf 'note: no module source found\n' >&2
fi
