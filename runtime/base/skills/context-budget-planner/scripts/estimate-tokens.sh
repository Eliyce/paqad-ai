#!/usr/bin/env bash
# Purpose: Compute token estimate from per-artifact (weight, path) rows.
# Usage:   bash scripts/estimate-tokens.sh --available <N> --committed <N>
#            (then provide rows on stdin: "<weight> <path>" per line)
# Output:  Markdown block matching assets/output.template.md.
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

available=200000
committed=30000

while [ "$#" -gt 0 ]; do
  case "$1" in
    --available) available="$2"; shift 2 ;;
    --committed) committed="$2"; shift 2 ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
done

usable=$(( available - committed ))

rows=""
total=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  weight=$(printf '%s' "$line" | awk '{print $1}')
  path=$(printf '%s' "$line"   | awk '{print $2}')
  if [ ! -f "$path" ]; then
    printf 'warn: missing file (counted as 0 lines): %s\n' "$path" >&2
    lines=0
  else
    lines=$(wc -l < "$path" | tr -d ' ')
  fi
  tokens=$(awk -v l="$lines" -v w="$weight" 'BEGIN{printf "%d", l*w}')
  total=$(( total + tokens ))
  rows="${rows}| \`${path}\` | ${lines} | ${weight} | ${tokens} |
"
done

headroom=$(( usable - total ))

# Tier per heuristics: green > 50% headroom, yellow > 25%, amber > 10%, red <= 10%.
pct=$(( usable > 0 ? (headroom * 100) / usable : 0 ))
if   [ "$pct" -gt 50 ]; then tier=green
elif [ "$pct" -gt 25 ]; then tier=yellow
elif [ "$pct" -gt 10 ]; then tier=amber
else                         tier=red
fi

printf '## Context Budget\n\n'
printf 'Summary: Tier: %s | Estimate: %d tokens | Available: %d tokens | Headroom: %d tokens\n\n' \
  "$tier" "$total" "$usable" "$headroom"
printf '### Per-Artifact Estimate\n\n'
printf '| Artifact | Lines | Weight | Tokens |\n'
printf '| --- | --- | --- | --- |\n'
printf '%s' "$rows"
printf '\n### Recommended Compactions\n\n'
case "$tier" in
  green|yellow) printf 'Recommended Compactions: none\n' ;;
  *) printf '1. {{LLM fills in compactions from references/budget-heuristics.md priority list}}\n' ;;
esac
