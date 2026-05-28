#!/usr/bin/env bash
# Purpose: Extract declared breakpoints from the responsive.md contract clause.
#          Emits a structured TSV the runtime walk + the LLM both consume.
#
# Usage:   bash scripts/extract-breakpoints.sh <responsive.md>
#
# Expected line shape in responsive.md (per references/responsive-checklist.md):
#
#   - sm: 640
#   - md: 768
#   - lg: 1024
#   - xl: 1280
#
# Output:  one TSV row per breakpoint to stdout:
#            <name>\t<width-px>
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
[ -n "$file" ] || { printf 'error: responsive.md path is required\n' >&2; exit 2; }
[ -f "$file" ] || { printf 'error: file not found: %s\n' "$file" >&2; exit 2; }

awk '
  /^[[:space:]]*[-*][[:space:]]+[a-zA-Z][a-zA-Z0-9_-]*[[:space:]]*:[[:space:]]*[0-9]+/ {
    line = $0
    sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
    colon = index(line, ":")
    name = substr(line, 1, colon - 1)
    rest = substr(line, colon + 1)
    gsub(/[[:space:]]+/, "", name)
    # The first run of digits in `rest` is the width in CSS pixels.
    n = match(rest, /[0-9]+/)
    if (n == 0) next
    width = substr(rest, RSTART, RLENGTH)
    printf "%s\t%d\n", name, width
  }
' "$file"
