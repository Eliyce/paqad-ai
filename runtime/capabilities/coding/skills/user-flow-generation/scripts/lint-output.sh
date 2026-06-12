#!/usr/bin/env bash
# Purpose: Validate user-flow-generation output sections.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

for h in '## Primary Flow' '## Alternate Paths'; do
  grep -qE "^${h}\$" <<<"$body" || say "missing \"${h}\""
done
grep -qE '(^## Flow Gaps|^Flow Gaps: none$)' <<<"$body" || say 'missing "## Flow Gaps" or exact "Flow Gaps: none"'

# Primary Flow must have at least one ordered item.
prim=$(printf '%s\n' "$body" | awk '/^## Primary Flow/{f=1;next} /^## /{f=0} f')
grep -qE '^[0-9]+\.[[:space:]]' <<<"$prim" || say 'Primary Flow must contain ordered list items (1. 2. ...)'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
