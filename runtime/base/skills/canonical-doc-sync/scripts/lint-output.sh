#!/usr/bin/env bash
# Purpose: Validate canonical-doc-sync output: requires "## Updated Docs"
#          (with at least one backticked .md path) and "## Known Drift"
#          (either bullets with backticked paths or the literal "none").
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
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

grep -qE '^## Updated Docs' <<<"$body" || say 'missing "## Updated Docs" heading'
grep -qE '^## Known Drift'  <<<"$body" || say 'missing "## Known Drift" heading'

upd=$(printf '%s\n' "$body" | awk '/^## Updated Docs/{f=1;next} /^## /{f=0} f')
grep -qE '`[^`]+\.md`' <<<"$upd" \
  || say '"## Updated Docs" must list at least one backticked .md path'

drift=$(printf '%s\n' "$body" | awk '/^## Known Drift/{f=1;next} /^## /{f=0} f')
if grep -qE '^\s*none\s*$' <<<"$drift"; then
  :
else
  grep -qE '`[^`]+\.md`' <<<"$drift" \
    || say '"## Known Drift" must list backticked .md paths or be exactly "none"'
fi

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
