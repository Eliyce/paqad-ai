#!/usr/bin/env bash
# Purpose: Pattern-scan source files for known performance hazards. LLM still
#          confirms each hit and decides severity by hot-path context.
# Usage:   bash scripts/scan-perf-smells.sh <file> [<file> ...]
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
    { grep -nE --binary-files=without-match "$pat" "$f" 2>/dev/null || true; } \
      | head -25 \
      | awk -v file="$f" -v s="$smell" -F: '
          { excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "%s | %s:%s | %s\n", s, file, $1, substr(excerpt,1,160) }'
  done
}

printf 'smell | file:line | excerpt\n'
scan 'await[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*\([^)]*\)[[:space:]]*$' 'await-in-loop-candidate' "$@"
scan '\.map\([^)]*async' 'async-map-no-Promise.all' "$@"
scan '\.findOne|\.find\(' 'orm-find-inside-loop-candidate' "$@"
scan 'for[[:space:]]*\([^)]+\)[[:space:]]*\{[^}]*await' 'for-loop-await' "$@"
scan 'JSON\.parse\(JSON\.stringify' 'deep-clone-via-JSON' "$@"
scan 'new RegExp\(' 'regex-compile-candidate' "$@"
scan 'console\.(log|info|debug)\(' 'log-in-hot-path-candidate' "$@"
scan '\.cache\(|cache\.set\(' 'cache-without-invalidation-candidate' "$@"
scan 'fetch\([^)]*\)[[:space:]]*$' 'sequential-fetch-candidate' "$@"
scan 'limit:[[:space:]]*0|LIMIT[[:space:]]+0' 'unbounded-pagination' "$@"
