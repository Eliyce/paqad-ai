#!/usr/bin/env bash
# Purpose: Find usages of disallowed terms in UI source given a glossary that
#          maps preferred -> alternatives (each alternative is a finding).
#
# Usage:   bash scripts/check-terminology.sh --preferred <Word> --avoid <a,b,c>
#                                            [--root <dir>] [--out <path>]
#          Default --root: src
#
# Output:  TSV rows to stdout:
#            <file>:<line>\t<found-word>\t<preferred>
#          Word matches are case-insensitive but the original casing is
#          reported in <found-word>.
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

preferred=""
avoid_csv=""
root="src"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --preferred) preferred="$2"; shift 2 ;;
    --avoid) avoid_csv="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$preferred" ] || { printf 'error: --preferred <word> is required\n' >&2; exit 2; }
[ -n "$avoid_csv" ] || { printf 'error: --avoid <csv> is required\n' >&2; exit 2; }
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  [ -n "$out" ] && { mkdir -p "$(dirname "$out")"; : > "$out"; }
  exit 0
fi

# Use ERE alternation with explicit boundaries (awk has no \b).
avoid_alt=$(printf '%s' "$avoid_csv" | tr ',' '\n' | awk 'NF' | tr -d ' ' | paste -sd'|' -)

emit() {
  # `(^|[^class])` alternation is fragile under BSD grep on macOS. Use the
  # ?-quantifier instead — matches zero-or-one boundary chars before the word.
  pattern="[^A-Za-z0-9_]?(${avoid_alt})[^A-Za-z0-9_]"
  # awk's match() is case-sensitive even when grep used -i, so we lowercase
  # both the excerpt and the pattern before matching, then map RSTART/RLENGTH
  # back onto the original excerpt to report the user's actual casing.
  pattern_lower=$(printf '%s' "$pattern" | tr '[:upper:]' '[:lower:]')
  { grep -rEn --binary-files=without-match -i \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
      --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' --exclude='*.snap' \
      -E "$pattern" "$root" 2>/dev/null || true; } \
    | awk -F: -v pat="$pattern_lower" -v pref="$preferred" '
        {
          excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
          excerpt_lower = tolower(excerpt)
          if (match(excerpt_lower, pat)) {
            s = substr(excerpt, RSTART, RLENGTH)
            gsub(/^[^A-Za-z0-9_]/, "", s)
            gsub(/[^A-Za-z0-9_]$/, "", s)
            printf "%s:%s\t%s\t%s\n", $1, $2, s, pref
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
