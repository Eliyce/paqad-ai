#!/usr/bin/env bash
# Purpose: Extract canonical module slugs from docs/instructions/rules/module-map.yml.
# Usage:   bash scripts/list-modules.sh [module-map.yml]
# Output:  Sorted unique module slugs.
# Exits:   0 ok | 1 module map missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
map="${1:-docs/instructions/rules/module-map.yml}"
[ -f "$map" ] || { printf 'error: module map not found: %s\n' "$map" >&2; exit 1; }
# Heuristic: slugs are top-level YAML keys (no leading whitespace).
{ grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' "$map" || true; } \
  | sed -E 's/^([a-z0-9_-]+):.*/\1/' \
  | sort -u
