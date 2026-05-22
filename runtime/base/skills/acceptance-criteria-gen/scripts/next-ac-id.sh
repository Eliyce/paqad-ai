#!/usr/bin/env bash
# Purpose: Print the next free AC identifier for a given FR (or single-level).
# Usage:   bash scripts/next-ac-id.sh <spec-file> [fr-number]
#          With fr-number: emits AC-{fr}.{next-n}
#          Without:        emits AC-{next-n}
# Output:  One AC id on stdout.
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ -z "${1:-}" ]; then
  printf 'usage: bash scripts/next-ac-id.sh <spec-file> [fr-number]\n' >&2
  exit 2
fi

spec="$1"
fr="${2:-}"

if [ ! -f "$spec" ]; then
  printf 'error: spec not found: %s\n' "$spec" >&2
  exit 2
fi

if [ -n "$fr" ]; then
  next=$( { grep -Eo "AC-${fr}\.[0-9]+" "$spec" || true; } \
    | awk -F. '{print $2}' \
    | sort -n \
    | tail -1)
  next=$(( ${next:-0} + 1 ))
  printf 'AC-%s.%s\n' "$fr" "$next"
else
  next=$( { grep -Eo 'AC-[0-9]+' "$spec" || true; } \
    | { grep -Ev '\.' || true; } \
    | awk -F- '{print $2}' \
    | sort -n \
    | tail -1)
  next=$(( ${next:-0} + 1 ))
  printf 'AC-%s\n' "$next"
fi
