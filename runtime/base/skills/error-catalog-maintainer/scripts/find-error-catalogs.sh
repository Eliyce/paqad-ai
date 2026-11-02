#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Locate per-module error-catalog.md / error-codes.md files.
Usage:   bash scripts/find-error-catalogs.sh [docs-modules-root]
Output:  Sorted unique paths.
USAGE
  exit 0
fi
root="${1:-docs/modules}"
[ -d "$root" ] || { echo "note: docs root not found: $root" >&2; exit 0; }
find "$root" -type f \( -name 'error-catalog.md' -o -name 'error-codes.md' \) 2>/dev/null | LC_ALL=C sort -u
