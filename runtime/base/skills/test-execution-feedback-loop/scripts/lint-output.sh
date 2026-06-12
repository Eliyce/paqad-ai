#!/usr/bin/env bash
# Purpose: Validate test-execution-feedback-loop output.
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
if grep -qE '^Fix Proposals: none — verification passed\.$' <<<"$body"; then
  printf 'ok\n'; exit 0
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Fix Proposals' <<<"$body" || say 'missing "## Fix Proposals"'
proposals=$(printf '%s\n' "$body" | grep -cE '^### Failure ' || true)
[ "${proposals:-0}" -eq 0 ] && say 'no "### Failure ..." subsections'

for needle in 'AC:' 'Failure category:' 'Anchor:' 'Root cause hypothesis:' 'Proposed fix:' 'Confidence:'; do
  hits=$(printf '%s' "$body" | grep -cE "^- \*\*${needle}|^- ${needle}" || true)
  [ "${hits:-0}" -lt "${proposals:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than proposals (${proposals:-0})"
done

grep -qE '^Total failures: [0-9]+ \| Combined into [0-9]+ proposals \| High-confidence: [0-9]+ \| Defer to human: [0-9]+' <<<"$body" \
  || say 'missing or malformed Total failures summary line'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
