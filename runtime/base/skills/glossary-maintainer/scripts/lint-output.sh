#!/usr/bin/env bash
# Purpose: Validate glossary-maintainer output: each updated term has a
#          "Used in:" line; "Glossary Updates: none" short circuit honored.
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

# Short circuit.
if printf '%s' "$body" | grep -qE '^Glossary Updates: none$'; then
  printf 'ok\n'; exit 0
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$body" | grep -qE '^## Glossary Updates'   || say 'missing "## Glossary Updates"'
printf '%s' "$body" | grep -qE '^## Terminology Drift'  || say 'missing "## Terminology Drift"'

# Each "- term:" entry under Glossary Updates needs a Used in: line within 4 lines.
awk '
  /^## Glossary Updates/ { in_g=1; next }
  /^## /                 { in_g=0 }
  in_g && /^- [^:]+:/    { term=$0; need=1; window=0; next }
  in_g && need {
    window++
    if ($0 ~ /Used in:/) { need=0 }
    else if (window>4 || /^- [^:]+:/ || /^## /) { print "missing Used in: for entry: " term; need=0; window=0 }
  }
' <<EOF | while IFS= read -r line; do say "$line"; done
$body
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
