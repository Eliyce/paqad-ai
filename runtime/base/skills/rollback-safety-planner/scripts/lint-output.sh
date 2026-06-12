#!/usr/bin/env bash
# Purpose: Validate rollback-safety-planner output. Each plan needs all template fields.
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

# Empty short-circuit.
if grep -qE '^Rollback Plans: none required \(all stories have easy reversibility and isolated blast radius\)\.$' <<<"$body"; then
  printf 'ok\n'; exit 0
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Rollback Plans' <<<"$body" || say 'missing "## Rollback Plans"'

# Each story header is "### S-<n>".
plans=$(printf '%s\n' "$body" | grep -cE '^### S-[0-9]+' || true)
[ "${plans:-0}" -eq 0 ] && say 'no "### S-<n>" plan headings'

for needle in 'Trigger:' 'Time-to-rollback:' 'Steps:' 'Verification:' 'Drill:'; do
  hits=$(printf '%s' "$body" | grep -cE "^- \*\*${needle}" || true)
  [ "${hits:-0}" -lt "${plans:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than plans (${plans:-0})"
done

grep -qE '^Coverage: Stories needing rollback plans: [0-9]+ \| Plans drafted: [0-9]+ \| Open Questions: [0-9]+' <<<"$body" \
  || say 'missing or malformed "Coverage:" footer line'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
