#!/usr/bin/env bash
# Purpose: Given a unified-diff hunk that touches a token source file
#          (src/design-tokens/* or tailwind.config.*), emit the tokens the
#          diff adds. Deterministic so the LLM doesn't re-derive what counts
#          as a "new token" from the prose of the diff.
#
# Usage:   bash scripts/detect-token-additions.sh                       (reads stdin)
#          bash scripts/detect-token-additions.sh <file>                (reads file)
#
# Recognised additions:
#   Lines beginning with `+` (and not `+++`) that contain a property
#   declaration like `<key>: '<value>'` or `<key>: "<value>"` where `<value>`
#   looks like a token value (hex, px, rem, em).
#
# Output:  TSV rows to stdout:
#            <key>\t<value>
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  body=$(cat)
elif [ -f "$1" ]; then
  body=$(cat "$1")
else
  printf 'error: file not found: %s\n' "$1" >&2
  exit 2
fi

printf '%s\n' "$body" | awk '
  /^\+\+\+/ { next }   # ignore file headers
  /^\+/ {
    line = $0
    sub(/^\+/, "", line)
    # Accept either an identifier key (`brand:`) or a quoted key
    # (`"14": '56px'` or `'14': '56px'`) — Tailwind config commonly uses both.
    if (match(line, /([A-Za-z][A-Za-z0-9_-]*|['"'"'"][A-Za-z0-9_-]+['"'"'"])[[:space:]]*:[[:space:]]*['"'"'"][^'"'"'"]+['"'"'"]/)) {
      s = substr(line, RSTART, RLENGTH)
      colon = index(s, ":")
      key = substr(s, 1, colon - 1)
      rest = substr(s, colon + 1)
      gsub(/[[:space:]]/, "", key)
      gsub(/^[[:space:]]+/, "", rest)
      # Strip surrounding quotes from key and value.
      gsub(/^['"'"'"]/, "", key)
      gsub(/['"'"'"]$/, "", key)
      gsub(/^['"'"'"]/, "", rest)
      gsub(/['"'"'"]$/, "", rest)
      # Only accept token-shaped values.
      if (rest ~ /^#[0-9A-Fa-f]+$/ || rest ~ /^[0-9]+(\.[0-9]+)?(px|rem|em)$/) {
        printf "%s\t%s\n", key, rest
      }
    }
  }
'
