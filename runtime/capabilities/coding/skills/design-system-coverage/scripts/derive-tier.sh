#!/usr/bin/env bash
# Purpose: Derive the design-system tier (missing | bare | adequate | strong)
#          from per-file clause counts. Pure function of the counts so the LLM
#          doesn't recompute the tier rule from prose on every run.
#
# Usage:   bash scripts/derive-tier.sh
#            Reads stdin: one TSV row per contract file as emitted by
#            count-clauses.sh — `<path-ending-in-{name}.md>\t<count>`.
#
# Output:  single line to stdout: `tier=<missing|bare|adequate|strong>`
#          then one diagnostic line per file (to stderr) explaining the count.
#
# Tier rules:
#   missing  — every contract file absent or count 0
#   bare     — tokens > 0 but components == 0 OR accessibility == 0
#   adequate — tokens > 0 AND components > 0 AND accessibility > 0
#              AND at least one of {responsive, motion, patterns} > 0
#   strong   — all six > 0
#
# Exits:   0 ok | 2 usage / malformed input
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

tokens=0
components=0
accessibility=0
responsive=0
motion=0
patterns=0

while IFS=$'\t' read -r path count || [ -n "${path:-}" ]; do
  [ -z "${path:-}" ] && continue
  case "$count" in (''|*[!0-9]*) printf 'error: non-numeric count for %s: %q\n' "$path" "$count" >&2; exit 2 ;; esac
  base=$(basename "$path")
  case "$base" in
    tokens.md)        tokens=$count ;;
    components.md)    components=$count ;;
    accessibility.md) accessibility=$count ;;
    responsive.md)    responsive=$count ;;
    motion.md)        motion=$count ;;
    patterns.md)      patterns=$count ;;
    *) printf 'note: ignoring unknown contract file: %s\n' "$path" >&2 ;;
  esac
done

total=$((tokens + components + accessibility + responsive + motion + patterns))

tier=""
if [ "$total" -eq 0 ]; then
  tier=missing
elif [ "$tokens" -gt 0 ] && [ "$components" -gt 0 ] && [ "$accessibility" -gt 0 ] \
    && [ "$responsive" -gt 0 ] && [ "$motion" -gt 0 ] && [ "$patterns" -gt 0 ]; then
  tier=strong
elif [ "$tokens" -gt 0 ] && [ "$components" -gt 0 ] && [ "$accessibility" -gt 0 ] \
    && [ $((responsive + motion + patterns)) -gt 0 ]; then
  tier=adequate
else
  tier=bare
fi

printf 'tier=%s\n' "$tier"
printf 'counts: tokens=%d components=%d accessibility=%d responsive=%d motion=%d patterns=%d\n' \
  "$tokens" "$components" "$accessibility" "$responsive" "$motion" "$patterns" >&2
