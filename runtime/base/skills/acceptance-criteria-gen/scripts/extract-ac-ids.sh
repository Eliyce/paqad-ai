#!/usr/bin/env bash
# Purpose: Extract all flat AC identifiers (AC-N) from a markdown spec.
# Usage:   bash scripts/extract-ac-ids.sh <spec-file>   (or pipe text on stdin)
# Output:  Sorted, deduplicated list of AC ids, one per line.
# Exits:   0 ok | 2 usage error
# Note:    Flat AC-N only (issue #512, C4) — the freeze parser reads flat ids, so a
#          dotted AC-N.N is not a valid criterion id and is not extracted here.
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

# Match AC-N but never the AC-N of a dotted AC-N.N (a negative lookbehind is not portable
# in grep, so match the whole token then drop any that carry a dot).
printf '%s' "$src" \
  | { grep -Eo 'AC-[0-9]+(\.[0-9]+)?' || true; } \
  | { grep -Ev '\.' || true; } \
  | sort -u -t- -k2 -n
