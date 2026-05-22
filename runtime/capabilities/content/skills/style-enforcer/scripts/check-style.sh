#!/usr/bin/env bash
# Purpose: Flag draft lines that violate either the project writing-style file
#          or the bundled default rules.
# Usage:   bash scripts/check-style.sh <draft> [style-file]
#          Style file format: "<directive>\t<pattern>" per non-comment line.
#          Directives: forbid | require-tone | warn
# Output:  rule | line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <draft> [style-file]\n' "$0" >&2; exit 2; }
draft="$1"

style="${2:-}"
if [ -z "$style" ]; then
  if [ -f "docs/instructions/rules/writing-style.md" ]; then
    # Extract simple "forbid:" lines from the markdown style file.
    style=$(mktemp)
    awk '
      /^[Ff]orbid:[[:space:]]*"?[^"]+"?/ {
        match($0, /["][^"]+["]/);
        if (RSTART) print "forbid\t" substr($0, RSTART+1, RLENGTH-2)
      }
    ' docs/instructions/rules/writing-style.md > "$style" || true
  else
    style="$(cd "$(dirname "$0")" && pwd)/../assets/default-rules.txt"
  fi
fi
[ -f "$style" ] || { printf 'note: no style rules found, exiting clean\n' >&2; exit 0; }

printf 'rule | line | excerpt\n'
while IFS=$'\t' read -r directive pattern; do
  case "$directive" in ''|\#*) continue ;; esac
  case "$directive" in
    forbid)
      { grep -nEi "$pattern" "$draft" 2>/dev/null || true; } \
        | head -25 \
        | awk -v p="$pattern" -F: '{ excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "forbid:%s | %s | %s\n", p, $1, substr(excerpt,1,160) }'
      ;;
    warn)
      { grep -nEi "$pattern" "$draft" 2>/dev/null || true; } \
        | head -25 \
        | awk -v p="$pattern" -F: '{ excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
            gsub(/[ \t]+/, " ", excerpt);
            printf "warn:%s | %s | %s\n", p, $1, substr(excerpt,1,160) }'
      ;;
  esac
done < "$style"
