#!/usr/bin/env bash
# Purpose: Validate cryptographic-review findings.
# Usage:   bash scripts/lint-findings.sh <file>   (or stdin)
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

printf '%s' "$body" | grep -qE '^## Findings' || say 'missing "## Findings"'
findings=$(printf '%s\n' "$body" | awk '/^## Findings/{f=1;next} /^## /{f=0} f && /^- /')
[ -z "$findings" ] && say 'no finding bullets under "## Findings"'

while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | grep -qE 'WSTG-CRYP-[0-9]+' || say "finding missing WSTG-CRYP-* id: $line"
  printf '%s' "$line" | grep -qE 'Evidence:.*[^[:space:]]+:[0-9]+' || say "finding missing 'Evidence: file:line': $line"
done <<EOF
$findings
EOF

# No raw secret leak: simple guard against quoted long base64-like strings in findings.
if printf '%s' "$body" | grep -qE '"[A-Za-z0-9+/=]{32,}"'; then
  say 'finding appears to embed a literal secret value — strip and reference file:line only'
fi

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
