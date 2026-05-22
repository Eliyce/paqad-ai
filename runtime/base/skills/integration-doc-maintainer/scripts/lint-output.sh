#!/usr/bin/env bash
# Purpose: Validate integration-doc-maintainer output.
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

printf '%s' "$body" | grep -qE '^## Updated Integration Docs' || say 'missing "## Updated Integration Docs"'
printf '%s' "$body" | grep -qE '^(## Consistency Warnings|^Consistency Warnings: none$)' \
  || say 'missing "## Consistency Warnings" or exact "Consistency Warnings: none" line'

upd=$(printf '%s\n' "$body" | awk '/^## Updated Integration Docs/{f=1;next} /^## /{f=0} f')
printf '%s' "$upd" | grep -qE '`[^`]+\.md`' \
  || say '"## Updated Integration Docs" must list at least one backticked .md path'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
