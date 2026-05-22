#!/usr/bin/env bash
# Purpose: Locate per-module error-catalog.md / error-codes.md files.
# Usage:   bash scripts/find-error-catalogs.sh [docs-modules-root]
# Output:  Sorted unique paths.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-docs/modules}"
[ -d "$root" ] || exit 0
find "$root" -type f \( -name 'error-catalog.md' -o -name 'error-codes.md' \) 2>/dev/null | sort -u
