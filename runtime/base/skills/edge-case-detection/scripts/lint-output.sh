#!/usr/bin/env bash
# Purpose: Validate edge-case-detection output. Each finding must have
#          Scenario, Why It Matters, Apply To.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

# Empty short-circuit.
if printf '%s' "$body" | grep -qE '^No Additional Edge Cases$'; then
  printf 'ok\n'; exit 0
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$body" | grep -qE '^## Edge Cases' || say 'missing "## Edge Cases" heading'

cases=$(printf '%s\n' "$body" | grep -cE '^### ' || true)
[ "${cases:-0}" -eq 0 ] && say 'no "### ..." case headings'

for needle in 'Scenario:' 'Why It Matters:' 'Apply To:'; do
  hits=$(printf '%s' "$body" | grep -cE "^- \*\*${needle}" || true)
  [ "${hits:-0}" -lt "${cases:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than cases (${cases:-0})"
done

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
