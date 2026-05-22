#!/usr/bin/env bash
# Purpose: Heuristic event-name extractor from changed source files.
# Usage:   bash scripts/extract-events.sh <file> [<file> ...]
# Output:  Sorted unique candidate event names (e.g. user.created, order.refunded).
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <file> ...\n' "$0" >&2; exit 2; }
{
  for f in "$@"; do
    [ -f "$f" ] || continue
    { grep -hEo "(emit|publish|dispatch|fire|send)[(\.][^,)]*[\"'][a-z][a-z0-9_]*\.[a-z][a-z0-9_]*[\"']" "$f" 2>/dev/null || true; } \
      | { grep -oE "[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*" || true; }
    { grep -hEo "[\"'][a-z][a-z0-9_]*\.[a-z][a-z0-9_]*[\"']" "$f" 2>/dev/null || true; } \
      | { grep -oE "[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*" || true; } \
      | { grep -E '\.(created|updated|deleted|completed|failed|started|finished|refunded|charged|invited)$' || true; }
  done
} | sort -u
