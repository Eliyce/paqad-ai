#!/usr/bin/env bash
# Purpose: Compare button labels in source against a declared action-verb
#          allow-list (from patterns.md). Anything outside the set is a copy
#          finding candidate.
#
# Usage:   bash scripts/check-action-verbs.sh --verbs <a,b,c> [--root <dir>]
#                                              [--out <path>]
#          Default --root: src
#
# Output:  one TSV row per offending button label, to stdout:
#            <file>:<line>\t<label>
#          Diagnostics to stderr.
#
# Recognised button labels:
#   <button ...>Label</button>
#   <Button ...>Label</Button>
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

verbs_csv=""
root="src"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verbs) verbs_csv="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$verbs_csv" ] || { printf 'error: --verbs <csv> is required\n' >&2; exit 2; }
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  [ -n "$out" ] && { mkdir -p "$(dirname "$out")"; : > "$out"; }
  exit 0
fi

# Build a pipe-separated allow-list of verbs (lowercase) for awk.
verbs_lower=$(printf '%s' "$verbs_csv" | tr ',' '\n' | tr -d ' ' | tr '[:upper:]' '[:lower:]' | awk 'NF' | paste -sd'|' -)

emit() {
  { grep -rEn --binary-files=without-match \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
      --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' \
      -E '<(button|Button)[^>]*>[A-Za-z][A-Za-z ]{0,40}</(button|Button)>' \
      "$root" 2>/dev/null || true; } \
    | awk -F: -v allow="$verbs_lower" '
        {
          excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
          if (match(excerpt, /<(button|Button)[^>]*>[A-Za-z][A-Za-z ]{0,40}</)) {
            s = substr(excerpt, RSTART, RLENGTH)
            sub(/^<[Bb]utton[^>]*>/, "", s)
            sub(/<$/, "", s)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
            if (length(s) == 0) next
            lower = tolower(s)
            n = split(allow, A, /\|/)
            ok = 0
            for (j=1; j<=n; j++) if (A[j] != "" && A[j] == lower) ok = 1
            if (!ok) printf "%s:%s\t%s\n", $1, $2, s
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
