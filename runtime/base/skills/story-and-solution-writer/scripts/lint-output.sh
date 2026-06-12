#!/usr/bin/env bash
# Purpose: Validate story-and-solution-writer output sections.
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

for h in '## Story' '## Constraints' '## Proposed Solution' '## Verification Notes'; do
  grep -qE "^${h}\$" <<<"$body" || say "missing \"${h}\""
done

# "## Pending Decisions" is optional — only validate if present.
[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
