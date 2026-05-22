#!/usr/bin/env bash
# Purpose: Enumerate canonical doc paths the project ships (module docs,
#          registries, business docs).
# Usage:   bash scripts/list-canonical-docs.sh [docs-root]
#          Default docs-root: docs
# Output:  Sorted unique canonical doc paths.
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-docs}"
[ -d "$root" ] || { printf 'note: docs root not found: %s\n' "$root" >&2; exit 0; }

find "$root" -type f -name '*.md' 2>/dev/null \
  | { grep -E '/(modules|business|registries|maintainers)/' || true; } \
  | sort -u
