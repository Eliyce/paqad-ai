#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: List docs/modules/* directories that are not declared in module-map.yml.
Usage:   bash scripts/list-orphan-module-dirs.sh
Output:  Sorted unique orphan slug directories.
USAGE
  exit 0
fi
map="docs/instructions/rules/module-map.yml"
[ -f "$map" ] || { printf 'error: missing %s\n' "$map" >&2; exit 1; }
[ -d "docs/modules" ] || exit 0

declared=$( { grep -E '^[a-z][a-z0-9_-]*:[[:space:]]*$' "$map" || true; } \
  | sed -E 's/^([a-z0-9_-]+):.*/\1/' \
  | LC_ALL=C sort -u)

for d in docs/modules/*/; do
  [ -d "$d" ] || continue
  slug=$(basename "$d")
  grep -qx "$slug" <<<"$declared" || printf 'docs/modules/%s\n' "$slug"
done | LC_ALL=C sort -u
