#!/usr/bin/env bash
# Purpose: Validate design-system-coverage output JSON.
# Usage:   bash scripts/validate-contract.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '"tier"[[:space:]]*:[[:space:]]*"(missing|bare|adequate|strong)"' <<<"$body" \
  || say 'missing or invalid "tier" — must be missing|bare|adequate|strong'

grep -qE '"files"[[:space:]]*:' <<<"$body" || say 'missing "files" array'
grep -qE '"clauses"[[:space:]]*:' <<<"$body" || say 'missing "clauses" object'

# If tier is adequate or strong, tokens/components/accessibility clause arrays
# must be non-empty.
if grep -qE '"tier"[[:space:]]*:[[:space:]]*"(adequate|strong)"' <<<"$body"; then
  for ns in tokens components accessibility; do
    if grep -qE "\"$ns\"[[:space:]]*:[[:space:]]*\\[[[:space:]]*\\]" <<<"$body"; then
      say "tier is adequate/strong but \"clauses.$ns\" is empty"
    fi
  done
fi

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
