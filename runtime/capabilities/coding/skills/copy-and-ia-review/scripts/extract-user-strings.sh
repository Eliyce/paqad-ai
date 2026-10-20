#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Extract user-facing strings from UI source — JSX text nodes,
         `aria-label`, `placeholder`, `title`. Deterministic extraction so
         the LLM doesn't re-derive what counts as "user-visible copy."

Usage:   bash scripts/extract-user-strings.sh [search-root]
         Default search-root: src

Output:  TSV rows to stdout:
           <category>\t<file>:<line>\t<string>
         Where <category> ∈ jsx-text | aria-label | placeholder | title.
         The <string> is the literal value (without quotes).
         Diagnostics to stderr.

USAGE
  exit 0
fi

root="${1:-src}"
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  exit 0
fi

exclude=(
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build
  --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' --exclude='*.snap'
)

{ grep -rEn --binary-files=without-match "${exclude[@]}" \
    'aria-label[[:space:]]*=[[:space:]]*"[^"]+"' "$root" 2>/dev/null || true; } \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (match(excerpt, /aria-label[[:space:]]*=[[:space:]]*"[^"]+"/)) {
        s = substr(excerpt, RSTART, RLENGTH)
        sub(/aria-label[[:space:]]*=[[:space:]]*"/, "", s)
        sub(/"$/, "", s)
        printf "aria-label\t%s:%s\t%s\n", $1, $2, s
      }
    }'

{ grep -rEn --binary-files=without-match "${exclude[@]}" \
    'placeholder[[:space:]]*=[[:space:]]*"[^"]+"' "$root" 2>/dev/null || true; } \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (match(excerpt, /placeholder[[:space:]]*=[[:space:]]*"[^"]+"/)) {
        s = substr(excerpt, RSTART, RLENGTH)
        sub(/placeholder[[:space:]]*=[[:space:]]*"/, "", s)
        sub(/"$/, "", s)
        printf "placeholder\t%s:%s\t%s\n", $1, $2, s
      }
    }'

{ grep -rEn --binary-files=without-match "${exclude[@]}" \
    '[[:space:]]title[[:space:]]*=[[:space:]]*"[^"]+"' "$root" 2>/dev/null || true; } \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (match(excerpt, /[[:space:]]title[[:space:]]*=[[:space:]]*"[^"]+"/)) {
        s = substr(excerpt, RSTART, RLENGTH)
        sub(/^.*title[[:space:]]*=[[:space:]]*"/, "", s)
        sub(/"$/, "", s)
        printf "title\t%s:%s\t%s\n", $1, $2, s
      }
    }'

{ grep -rEn --binary-files=without-match "${exclude[@]}" \
    '>[ABCDEFGHIJKLMNOPQRSTUVWXYZ][A-Za-z0-9 ,.:?!()-]{1,80}<' "$root" 2>/dev/null || true; } \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (match(excerpt, />[ABCDEFGHIJKLMNOPQRSTUVWXYZ][A-Za-z0-9 ,.:?!()-]+</)) {
        s = substr(excerpt, RSTART, RLENGTH)
        sub(/^>/, "", s)
        sub(/<$/, "", s)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
        if (length(s) >= 2 && length(s) <= 81) {
          printf "jsx-text\t%s:%s\t%s\n", $1, $2, s
        }
      }
    }'
