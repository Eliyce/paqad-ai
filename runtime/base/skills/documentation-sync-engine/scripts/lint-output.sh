#!/usr/bin/env bash
# Purpose: Validate documentation-sync-engine output.
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

# Empty short-circuit.
if printf '%s' "$body" | grep -qE '^Documentation Sync: no canonical docs require update\.$'; then
  printf 'ok\n'; exit 0
fi

printf '%s' "$body" | grep -qE '^## Documentation Sync' || say 'missing "## Documentation Sync"'
printf '%s' "$body" | grep -qE '^Stale Doc Set: Detected: [0-9]+ \| Routed: [0-9]+ \| Skipped \(target_domains filter\): [0-9]+' \
  || say 'missing or malformed Stale Doc Set summary'
printf '%s' "$body" | grep -qE '^Known Drift' || say 'missing "Known Drift" section/line'

# Domain headings must come from the allowed set when present.
domains=$(printf '%s\n' "$body" | grep -E '^### ' | sed -E 's/^### //; s/[[:space:]]+$//')
while IFS= read -r d; do
  [ -z "$d" ] && continue
  case "$d" in
    api|integration|error|glossary|canonical) ;;
    *) say "unknown delegate domain: $d" ;;
  esac
done <<EOF
$domains
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
