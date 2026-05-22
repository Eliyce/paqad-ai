#!/usr/bin/env bash
# Purpose: Find query patterns that imply index requirements (WHERE, ORDER BY,
#          JOIN, GROUP BY) in source / migration files.
# Usage:   bash scripts/scan-query-shapes.sh <file> [<file> ...]
# Output:  shape | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <file> ...\n' "$0" >&2; exit 2; }

scan() {
  pat="$1"; shape="$2"
  for f in "${@:3}"; do
    [ -f "$f" ] || continue
    { grep -nEi --binary-files=without-match "$pat" "$f" 2>/dev/null || true; } \
      | head -25 \
      | awk -v file="$f" -v s="$shape" -F: '
          { excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "%s | %s:%s | %s\n", s, file, $1, substr(excerpt,1,160) }'
  done
}

printf 'shape | file:line | excerpt\n'
scan 'where[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]*=' 'equality-filter' "$@"
scan 'where[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]+(in|like)\b' 'in-or-like-filter' "$@"
scan 'order[[:space:]]+by[[:space:]]+[a-z_]' 'order-by' "$@"
scan 'join[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]+on[[:space:]]+' 'join-on' "$@"
scan 'group[[:space:]]+by[[:space:]]+[a-z_]' 'group-by' "$@"
scan 'unique[[:space:]]+(index|constraint)|add[[:space:]]+unique' 'uniqueness-rule' "$@"
