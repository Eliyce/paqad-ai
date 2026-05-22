#!/usr/bin/env bash
# Purpose: List docs/modules/* directories that are not declared in module-map.yml.
# Usage:   bash scripts/list-orphan-module-dirs.sh
# Output:  Sorted unique orphan slug directories.
# Exits:   0 ok | 1 prereq missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
map="docs/instructions/rules/module-map.yml"
[ -f "$map" ] || { printf 'error: missing %s\n' "$map" >&2; exit 1; }
[ -d "docs/modules" ] || exit 0

declared=$( { grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' "$map" || true; } \
  | sed -E 's/^([a-z0-9_-]+):.*/\1/' \
  | sort -u)

for d in docs/modules/*/; do
  [ -d "$d" ] || continue
  slug=$(basename "$d")
  printf '%s\n' "$declared" | grep -qx "$slug" || printf 'docs/modules/%s\n' "$slug"
done | sort -u
