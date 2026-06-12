#!/usr/bin/env bash
# Purpose: Validate business-logic abuse findings.
# Usage:   bash scripts/lint-findings.sh <file>   (or stdin)
# Checks:  has "## Findings"; each finding has Module:, Step:, Abuse case:,
#          Missing proof:, and Reproduction: segments.
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Findings' <<<"$body" || say 'missing "## Findings" heading'

# Each finding starts with "### " under Findings.
findings=$(printf '%s\n' "$body" | awk '/^## Findings/{f=1;next} /^## /{f=0} f' )
count=$(printf '%s\n' "$findings" | grep -cE '^### ' || true)
[ "${count:-0}" -eq 0 ] && say 'no "### ..." finding subsections'

for needle in 'Module:' 'Step:' 'Abuse case:' 'Missing proof:' 'Reproduction:'; do
  hits=$(printf '%s' "$findings" | grep -cE "^- \*\*${needle}" || true)
  [ "${hits:-0}" -lt "${count:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than findings (${count:-0})"
done

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
