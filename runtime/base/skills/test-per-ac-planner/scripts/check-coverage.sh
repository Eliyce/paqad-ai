#!/usr/bin/env bash
# Purpose: Given an AC list and a verification plan markdown, return AC ids
#          that are NOT covered (no T-id assigned).
# Usage:   bash scripts/check-coverage.sh <ac-file> <plan-file>
# Output:  Sorted unique uncovered AC ids.
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] && [ -f "${2:-}" ] || { printf 'usage: %s <ac-file> <plan-file>\n' "$0" >&2; exit 2; }

ac_ids=$( { grep -hEo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | sort -u)
plan_acs=$( { grep -hE '^### AC-' "$2" || true; } | { grep -hEo 'AC-[0-9]+(\.[0-9]+)?' || true; } | sort -u)

# Set difference: in ac_ids but not in plan_acs.
comm -23 <(printf '%s\n' "$ac_ids") <(printf '%s\n' "$plan_acs")
