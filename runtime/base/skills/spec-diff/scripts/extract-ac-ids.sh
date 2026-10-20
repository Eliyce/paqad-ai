#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Extract sorted unique AC ids from one or more spec files.
Usage:   bash scripts/extract-ac-ids.sh <spec-file> [<spec-file> ...]
Output:  Sorted unique AC ids.
USAGE
  exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <spec-file> ...\n' "$0" >&2; exit 2; }
{ for f in "$@"; do
  [ -f "$f" ] || continue
  grep -hEo 'AC-[0-9]+(\.[0-9]+)?' "$f" 2>/dev/null || true
done; } | sort -u
