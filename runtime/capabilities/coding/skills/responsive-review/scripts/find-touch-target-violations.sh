#!/usr/bin/env bash
# Purpose: Grep UI source for icon-only / tap targets whose declared sizing is
#          below the WCAG-2.2-2.5.8 minimum (default 24×24 CSS pixels). The
#          minimum is configurable via --min. Emits candidate lines the LLM
#          confirms — anything declaring a width/height < the minimum or using
#          a Tailwind size utility below the floor.
#
# Usage:   bash scripts/find-touch-target-violations.sh [search-root]
#                                                       [--min <px>]
#                                                       [--out <path>]
#          Default search-root: src
#          Default --min: 24
#
# Output:  TSV rows to stdout:
#            <file>:<line>\t<size-px>\t<excerpt>
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="src"
min=24
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --min) min="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --*) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
    *) root="$1"; shift ;;
  esac
done

case "$min" in (''|*[!0-9]*) printf 'error: --min must be a positive integer\n' >&2; exit 2 ;; esac
[ "$min" -gt 0 ] || { printf 'error: --min must be > 0\n' >&2; exit 2; }

if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  [ -n "$out" ] && { mkdir -p "$(dirname "$out")"; : > "$out"; }
  exit 0
fi

# Find lines that declare a width or height in raw px values OR Tailwind
# size utilities (`w-N` / `h-N` where N is in Tailwind's 0.25rem scale).
# Note: awk POSIX ERE has no `\b`, so we use explicit boundary chars.
candidates=$(grep -rEn --binary-files=without-match \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
  --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' \
  -E '(width|height)[[:space:]]*:[[:space:]]*[0-9]+(\.[0-9]+)?px|(^|[^A-Za-z0-9_-])[wh]-[0-9]+([^A-Za-z0-9_-]|$)' \
  "$root" 2>/dev/null || true)

emit() {
  printf '%s' "$candidates" | awk -F: -v M="$min" '
    NF >= 3 {
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      gsub(/[ \t]+/, " ", excerpt)

      px = 0

      # CSS: width/height: <N>px
      if (match(excerpt, /(width|height)[[:space:]]*:[[:space:]]*[0-9]+(\.[0-9]+)?px/)) {
        s = substr(excerpt, RSTART, RLENGTH)
        if (match(s, /[0-9]+(\.[0-9]+)?/)) {
          px = substr(s, RSTART, RLENGTH) + 0
        }
      }

      # Tailwind: w-N / h-N where N maps to N * 0.25rem = N * 4px (assuming the
      # default 16px root font size; projects with different roots will still
      # see N*4 — the LLM picks severity, not the script).
      if (px == 0 && match(excerpt, /(^|[^A-Za-z0-9_-])[wh]-[0-9]+([^A-Za-z0-9_-]|$)/)) {
        s = substr(excerpt, RSTART, RLENGTH)
        if (match(s, /[0-9]+/)) {
          n = substr(s, RSTART, RLENGTH) + 0
          px = n * 4
        }
      }

      if (px > 0 && px < M) {
        printf "%s:%s\t%d\t%s\n", $1, $2, px, substr(excerpt, 1, 140)
      }
    }
  '
}

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  emit > "$out"
  printf 'wrote %s\n' "$out"
else
  emit
fi
