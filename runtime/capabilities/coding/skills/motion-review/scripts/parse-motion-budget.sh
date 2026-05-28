#!/usr/bin/env bash
# Purpose: Parse the motion.md contract clause and emit the declared budget so
#          downstream scripts (and the LLM) compare durations against a known
#          ceiling instead of inferring one.
#
# Usage:   bash scripts/parse-motion-budget.sh <motion.md>
#
# Expected lines (per references/motion-checklist.md):
#
#   - duration-ceiling: 400ms
#   - easing: standard, enter, exit
#   - reduced-motion: respected
#
# Output:  one TSV row per declared key to stdout:
#            <key>\t<value>
#          (`value` for easing is the CSV-joined list as-is.)
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
[ -n "$file" ] || { printf 'error: motion.md path is required\n' >&2; exit 2; }
[ -f "$file" ] || { printf 'error: file not found: %s\n' "$file" >&2; exit 2; }

awk '
  /^[[:space:]]*[-*][[:space:]]+(duration-ceiling|easing|reduced-motion)[[:space:]]*:/ {
    line = $0
    sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
    colon = index(line, ":")
    key = substr(line, 1, colon - 1)
    val = substr(line, colon + 1)
    gsub(/^[[:space:]]+/, "", val); gsub(/[[:space:]]+$/, "", val)
    gsub(/[[:space:]]+/, "", key)
    printf "%s\t%s\n", key, val
  }
' "$file"
