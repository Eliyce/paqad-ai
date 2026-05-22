#!/usr/bin/env bash
# Purpose: Validate runtime-surface-probing findings.
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

# Each finding must include path and observed status.
findings=$(printf '%s\n' "$body" | awk '/^## Findings/{f=1;next} /^## /{f=0} f && /^- /')
while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | grep -qE 'Path:[[:space:]]*`[^`]+`' || say "finding missing 'Path: \`...\`': $line"
  printf '%s' "$line" | grep -qE 'Status:[[:space:]]*[1-5][0-9][0-9]' || say "finding missing numeric Status: $line"
done <<EOF
$findings
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
