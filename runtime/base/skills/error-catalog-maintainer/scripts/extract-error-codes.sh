#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Grep changed source files for likely error-code constants/strings.
Usage:   bash scripts/extract-error-codes.sh <file> [<file> ...]
Output:  Sorted unique candidate codes (UPPER_SNAKE or kebab-case prefixed).
USAGE
  exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <file> ...\n' "$0" >&2; exit 2; }

{
  for f in "$@"; do
    [ -f "$f" ] || continue
    grep -hEo "[A-Z][A-Z0-9_]{3,}_(ERROR|FAILED|INVALID|MISSING|NOT_FOUND|FORBIDDEN|CONFLICT)" "$f" 2>/dev/null || true
    { grep -hEo "(code|errorCode)[[:space:]]*[:=][[:space:]]*[\"'][a-z][a-z0-9_-]+[\"']" "$f" 2>/dev/null || true; } \
      | { grep -oE "[\"'][a-z][a-z0-9_-]+[\"']" || true; } \
      | tr -d '"'"'"
  done
} | LC_ALL=C sort -u
