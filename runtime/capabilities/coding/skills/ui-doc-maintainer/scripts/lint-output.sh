#!/usr/bin/env bash
# Purpose: Validate ui-doc-maintainer output sections.
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

grep -qE '^## Updated UI Docs' <<<"$body" || say 'missing "## Updated UI Docs"'
grep -qE '(^## Open UI Gaps|^Open UI Gaps: none$)' <<<"$body" || say 'missing "## Open UI Gaps" or exact "Open UI Gaps: none"'

upd=$(printf '%s\n' "$body" | awk '/^## Updated UI Docs/{f=1;next} /^## /{f=0} f')
grep -qE '`[^`]+\.md`' <<<"$upd" || say '"## Updated UI Docs" must list at least one backticked .md path'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
