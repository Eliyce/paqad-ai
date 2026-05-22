#!/usr/bin/env bash
# Purpose: Word count for a draft (excluding fenced code blocks and frontmatter).
# Usage:   bash scripts/word-count.sh <file>
# Output:  Single integer.
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <file>\n' "$0" >&2; exit 2; }
awk '
  BEGIN { in_fence=0; in_fm=0; fm_seen=0 }
  NR==1 && /^---$/ { in_fm=1; fm_seen=1; next }
  in_fm && /^---$/ { in_fm=0; next }
  in_fm { next }
  /^```/ { in_fence = !in_fence; next }
  !in_fence { print }
' "$1" | wc -w | tr -d ' '
