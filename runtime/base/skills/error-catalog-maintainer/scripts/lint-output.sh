#!/usr/bin/env bash
# Purpose: Validate error-catalog-maintainer output.
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

printf '%s' "$body" | grep -qE '^## Updated Error Entries' || say 'missing "## Updated Error Entries"'
printf '%s' "$body" | grep -qE '^## Catalog Gaps'         || say 'missing "## Catalog Gaps"'

upd=$(printf '%s\n' "$body" | awk '/^## Updated Error Entries/{f=1;next} /^## /{f=0} f')
printf '%s' "$upd" | grep -qE '`[^`]+`' \
  || say '"## Updated Error Entries" must list backticked entries (code or path)'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
