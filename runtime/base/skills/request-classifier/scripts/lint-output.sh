#!/usr/bin/env bash
# Purpose: Validate request-classifier output. Requires "## Classification"
#          and a complete dimension set, plus "Evidence" section.
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

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Classification' <<<"$body" || say 'missing "## Classification"'
for k in 'workflow' 'scope' 'risk' 'ui_impact' 'api_impact' 'db_impact'; do
  grep -qE "^${k}:[[:space:]]" <<<"$body" || say "missing dimension: ${k}"
done
grep -qE '^## Evidence|^Evidence:' <<<"$body" || say 'missing "Evidence" section/line'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
