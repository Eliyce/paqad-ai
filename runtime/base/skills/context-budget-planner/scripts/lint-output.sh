#!/usr/bin/env bash
# Purpose: Validate context-budget-planner output.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$body" | grep -qE '^## Context Budget' || say 'missing "## Context Budget"'
printf '%s' "$body" | grep -qE '^Summary: Tier: (green|yellow|amber|red) \| Estimate: [0-9]+ tokens \| Available: [0-9]+ tokens \| Headroom: -?[0-9]+ tokens' \
  || say 'missing or malformed Summary line'
printf '%s' "$body" | grep -qE '^### Per-Artifact Estimate' || say 'missing "### Per-Artifact Estimate"'
printf '%s' "$body" | grep -qE '^### Recommended Compactions' || say 'missing "### Recommended Compactions"'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
