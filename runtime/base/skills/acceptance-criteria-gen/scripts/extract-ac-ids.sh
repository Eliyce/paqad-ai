#!/usr/bin/env bash
# Purpose: Extract all AC identifiers (AC-N or AC-N.N) from a markdown spec.
# Usage:   bash scripts/extract-ac-ids.sh <spec-file>   (or pipe text on stdin)
# Output:  Sorted, deduplicated list of AC ids, one per line.
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

src=""
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  src=$(cat)
elif [ -f "$1" ]; then
  src=$(cat "$1")
else
  printf 'error: file not found: %s\n' "$1" >&2
  exit 2
fi

printf '%s' "$src" \
  | { grep -Eo 'AC-[0-9]+(\.[0-9]+)?' || true; } \
  | sort -u
