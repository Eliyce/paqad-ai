#!/usr/bin/env bash
# Purpose: Extract sorted unique AC ids from the acceptance criteria artifact.
# Usage:   bash scripts/extract-ac-ids.sh <ac-file>
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,3p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <ac-file>\n' "$0" >&2; exit 2; }
{ grep -hEo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | sort -u
