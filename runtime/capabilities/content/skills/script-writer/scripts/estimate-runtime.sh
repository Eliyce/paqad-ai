#!/usr/bin/env bash
# Purpose: Estimate spoken runtime of a script (default 150 wpm).
# Usage:   bash scripts/estimate-runtime.sh <file> [wpm]
# Output:  Words: <N> | WPM: <N> | Runtime: <MM:SS>
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <file> [wpm]\n' "$0" >&2; exit 2; }
file="$1"; wpm="${2:-150}"

# Count only VO: lines (the spoken portion).
words=$( { grep -E '^[[:space:]]*-[[:space:]]*\*\*VO:\*\*|^VO:|^- VO:' "$file" 2>/dev/null || true; } \
  | sed -E 's/.*VO:[[:space:]]*//; s/\*\*//g' \
  | wc -w \
  | tr -d ' ')

[ -z "$words" ] && words=0
total_seconds=$(awk -v w="$words" -v r="$wpm" 'BEGIN{printf "%d", (w*60)/r}')
mm=$((total_seconds / 60))
ss=$((total_seconds % 60))
printf 'Words: %s | WPM: %s | Runtime: %02d:%02d\n' "$words" "$wpm" "$mm" "$ss"
