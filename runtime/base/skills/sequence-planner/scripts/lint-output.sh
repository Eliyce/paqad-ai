#!/usr/bin/env bash
# Purpose: Validate sequence-planner output. Stories numbered sequentially
#          from 1, each with goal/dependencies/verification segments.
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

grep -qE '^## Implementation Sequence' <<<"$body" || say 'missing "## Implementation Sequence"'
grep -qE '^## Sequencing Risks'        <<<"$body" || say 'missing "## Sequencing Risks"'

# Story numbering must start at 1 and increment by 1.
nums=$(printf '%s\n' "$body" | grep -E '^### Story [0-9]+' | grep -oE '[0-9]+' | sort -n)
if [ -n "$nums" ]; then
  expected=1
  while IFS= read -r n; do
    [ "$n" -eq "$expected" ] || { say "story numbering broken: expected $expected, got $n"; break; }
    expected=$((expected+1))
  done <<EOF
$nums
EOF
fi

# Each story must have Goal:, Dependencies:, Verification:.
stories=$(printf '%s' "$body" | grep -cE '^### Story [0-9]+' || true)
for needle in 'Goal:' 'Dependencies:' 'Verification:'; do
  hits=$(printf '%s' "$body" | grep -cE "^- \*\*${needle}" || true)
  [ "${hits:-0}" -lt "${stories:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than stories (${stories:-0})"
done

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
