#!/usr/bin/env bash
# Purpose: Pattern-scan source / SQL files for known query risks.
# Usage:   bash scripts/scan-query-risks.sh <file> [<file> ...]
# Output:  risk | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ "$#" -ge 1 ] || { printf 'usage: %s <file> ...\n' "$0" >&2; exit 2; }

scan() {
  pat="$1"; risk="$2"
  for f in "${@:3}"; do
    [ -f "$f" ] || continue
    { grep -nEi --binary-files=without-match "$pat" "$f" 2>/dev/null || true; } \
      | head -25 \
      | awk -v file="$f" -v r="$risk" -F: '
          { excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "%s | %s:%s | %s\n", r, file, $1, substr(excerpt,1,160) }'
  done
}

printf 'risk | file:line | excerpt\n'
scan '\.findOne|\.find\(.*\)|\.first\(' 'orm-find-inside-loop-candidate' "$@"
scan '\.map\(.*\bawait\b' 'await-inside-map' "$@"
scan 'select[[:space:]]+\*' 'over-fetching-select-star' "$@"
scan 'limit[[:space:]]*[:=]?[[:space:]]*0|LIMIT[[:space:]]+0' 'unbounded-pagination' "$@"
scan 'order[[:space:]]+by[[:space:]]+random' 'non-deterministic-order' "$@"
scan 'where[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]*(=|like)[[:space:]]*[\"'"'"']%' 'leading-wildcard-like' "$@"
scan '\bN\+1\b|n-plus-one' 'flagged-n-plus-one' "$@"
scan 'group[[:space:]]+by[[:space:]]+[a-z_].*[[:space:]]+having' 'group-having' "$@"
