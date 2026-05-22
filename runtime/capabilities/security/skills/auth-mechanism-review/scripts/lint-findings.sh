#!/usr/bin/env bash
# Purpose: Validate auth-mechanism-review output. Each finding must include
#          a WSTG-* test id and an Evidence: file:line citation.
# Usage:   bash scripts/lint-findings.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues found | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$body" | grep -qE '^## Findings' || say 'missing "## Findings" heading'

findings=$(printf '%s\n' "$body" | awk '/^## Findings/{f=1;next} /^## /{f=0} f && /^- /')
[ -z "$findings" ] && say 'no finding bullets under "## Findings"'

while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | grep -qE 'WSTG-[A-Z]+-[0-9]+' || say "finding missing WSTG id: $line"
  printf '%s' "$line" | grep -qE 'Evidence:.*[^[:space:]]+:[0-9]+' || say "finding missing 'Evidence: file:line': $line"
done <<EOF
$findings
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
