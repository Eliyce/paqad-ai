#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Extract sorted unique AC ids from the acceptance criteria artifact.
Usage:   bash scripts/extract-ac-ids.sh <ac-file>
USAGE
  exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <ac-file>\n' "$0" >&2; exit 2; }
{ grep -hEo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | LC_ALL=C sort -u
