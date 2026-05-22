#!/usr/bin/env bash
# Purpose: Pattern-scan migration files for known unsafe operations.
# Usage:   bash scripts/scan-migration-smells.sh <file> [<file> ...]
# Output:  smell | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <file> ...\n' "$0" >&2; exit 2; }

scan() {
  pat="$1"; smell="$2"
  for f in "${@:3}"; do
    [ -f "$f" ] || continue
    { grep -nEi --binary-files=without-match "$pat" "$f" 2>/dev/null || true; } \
      | head -25 \
      | awk -v file="$f" -v s="$smell" -F: '
          { excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "%s | %s:%s | %s\n", s, file, $1, substr(excerpt,1,160) }'
  done
}

printf 'smell | file:line | excerpt\n'
scan 'drop[[:space:]]+(table|column)|drop_(table|column)' 'destructive-drop' "$@"
scan '(alter[[:space:]]+table[^;]+drop[[:space:]]+constraint)|drop_foreign_key|drop_index' 'destructive-drop-constraint' "$@"
scan 'add[[:space:]]+column[^;]+not[[:space:]]+null([^,;]*default)?' 'not-null-without-default' "$@"
scan '(rename[[:space:]]+(table|column))|rename_(table|column)' 'rename-without-shim' "$@"
scan 'truncate[[:space:]]+|delete[[:space:]]+from[[:space:]]+[^;]+;' 'data-deletion' "$@"
scan 'change[[:space:]]+column[^;]+type|alter[[:space:]]+column[^;]+type|change_column' 'type-change' "$@"
scan '(unique[[:space:]]+index|add[[:space:]]+unique)' 'add-unique-without-clean-data-check' "$@"
scan 'lock[[:space:]]+table' 'explicit-table-lock' "$@"
