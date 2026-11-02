#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Given an AC list and a verification plan markdown, return AC ids
         that are NOT covered (no T-id assigned).
Usage:   bash scripts/check-coverage.sh <ac-file> <plan-file>
USAGE
  exit 0
fi
[ -f "${1:-}" ] && [ -f "${2:-}" ] || { printf 'usage: %s <ac-file> <plan-file>\n' "$0" >&2; exit 2; }

ac_ids=$( { grep -hEo 'AC-[0-9]+(\.[0-9]+)?' "$1" || true; } | LC_ALL=C sort -u)
plan_acs=$( { grep -hE '^### AC-' "$2" || true; } | { grep -hEo 'AC-[0-9]+(\.[0-9]+)?' || true; } | LC_ALL=C sort -u)

LC_ALL=C comm -23 <(printf '%s\n' "$ac_ids") <(printf '%s\n' "$plan_acs")
