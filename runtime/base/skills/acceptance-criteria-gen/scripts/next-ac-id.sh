#!/usr/bin/env bash
# Purpose: Print the next free flat AC identifier (AC-N) for a spec.
# Usage:   bash scripts/next-ac-id.sh <spec-file>
# Output:  One AC id (AC-{max+1}) on stdout.
# Exits:   0 ok | 2 usage error
# Note:    Flat AC-N only (issue #512, C4). The freeze parser reads flat ids; a dotted
#          AC-N.N would be renumbered/dropped, so this allocator never emits one.
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ -z "${1:-}" ]; then
  printf 'usage: bash scripts/next-ac-id.sh <spec-file>\n' >&2
  exit 2
fi

spec="$1"

if [ ! -f "$spec" ]; then
  printf 'error: spec not found: %s\n' "$spec" >&2
  exit 2
fi

# Highest existing flat AC-N (dotted AC-N.N ids are ignored — they are not valid), +1.
next=$( { grep -Eo 'AC-[0-9]+(\.[0-9]+)?' "$spec" || true; } \
  | { grep -Ev '\.' || true; } \
  | awk -F- '{print $2}' \
  | sort -n \
  | tail -1)
next=$(( ${next:-0} + 1 ))
printf 'AC-%s\n' "$next"
