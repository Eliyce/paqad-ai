#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Extract canonical module slugs from docs/instructions/rules/module-map.yml.
Usage:   bash scripts/list-modules.sh [module-map.yml]
Output:  Sorted unique module slugs.
Exits:   0 ok | 1 module map missing | 2 usage error
USAGE
  exit 0
fi
map="${1:-docs/instructions/rules/module-map.yml}"
[ -f "$map" ] || { printf 'error: module map not found: %s\n' "$map" >&2; exit 1; }
{ grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' "$map" || true; } \
  | sed -E 's/^([a-z0-9_-]+):.*/\1/' \
  | LC_ALL=C sort -u
