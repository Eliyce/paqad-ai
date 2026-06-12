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

grep -qE '^## Context Budget' <<<"$body" || say 'missing "## Context Budget"'
grep -qE '^Summary: Tier: (green|yellow|amber|red) \| Estimate: [0-9]+ tokens \| Available: [0-9]+ tokens \| Headroom: -?[0-9]+ tokens' <<<"$body" \
  || say 'missing or malformed Summary line'
grep -qE '^### Per-Artifact Estimate' <<<"$body" || say 'missing "### Per-Artifact Estimate"'
grep -qE '^### Recommended Compactions' <<<"$body" || say 'missing "### Recommended Compactions"'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
