#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Extract the canonical AC id set from an acceptance-criteria artifact.
Usage:   bash scripts/extract-ac-ids.sh <ac-file>
Output:  Sorted unique AC ids (one per line).
USAGE
  exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: bash scripts/extract-ac-ids.sh <ac-file>\n' >&2; exit 2; }
{ grep -Eo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | LC_ALL=C sort -u
