#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Locate canonical per-module API doc files (endpoints.md, schemas.md, error-codes.md).
Usage:   bash scripts/find-api-docs.sh [docs-root]
         Default docs-root: docs/modules
Output:  Sorted unique paths to existing canonical API docs.
Exits:   0 ok | 2 usage error
USAGE
  exit 0
fi

root="${1:-docs/modules}"
if [ ! -d "$root" ]; then
  printf 'note: docs root not found, returning empty: %s\n' "$root" >&2
  exit 0
fi

find "$root" -type f \( \
  -path '*/api/endpoints.md' -o \
  -path '*/api/schemas.md' -o \
  -path '*/api/error-codes.md' \
  \) 2>/dev/null | sort -u
