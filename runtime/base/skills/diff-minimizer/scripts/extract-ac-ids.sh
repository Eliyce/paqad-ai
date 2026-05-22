#!/usr/bin/env bash
# Purpose: Extract the canonical AC id set from an acceptance-criteria artifact.
# Usage:   bash scripts/extract-ac-ids.sh <ac-file>
# Output:  Sorted unique AC ids (one per line).
# Exits:   0 ok | 1 missing file | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: bash scripts/extract-ac-ids.sh <ac-file>\n' >&2; exit 2; }
{ grep -Eo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | sort -u
