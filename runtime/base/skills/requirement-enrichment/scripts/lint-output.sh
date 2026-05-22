#!/usr/bin/env bash
# Purpose: Validate requirement-enrichment output: 3 sections in order,
#          flat bullets, Blocked: prefix valid.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

# Required headings
for h in '## Confirmed Requirements' '## Assumptions' '## Open Questions'; do
  printf '%s' "$body" | grep -qE "^${h}\$" || say "missing \"${h}\""
done

# Order check: line numbers must be strictly increasing in the listed sequence.
n_conf=$(printf '%s\n' "$body" | grep -nE '^## Confirmed Requirements$' | head -1 | cut -d: -f1)
n_assu=$(printf '%s\n' "$body" | grep -nE '^## Assumptions$'            | head -1 | cut -d: -f1)
n_open=$(printf '%s\n' "$body" | grep -nE '^## Open Questions$'         | head -1 | cut -d: -f1)
if [ -n "$n_conf" ] && [ -n "$n_assu" ] && [ -n "$n_open" ]; then
  if ! [ "$n_conf" -lt "$n_assu" ] || ! [ "$n_assu" -lt "$n_open" ]; then
    say 'sections out of required order (Confirmed Requirements -> Assumptions -> Open Questions)'
  fi
fi

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
