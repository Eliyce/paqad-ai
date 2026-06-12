#!/usr/bin/env bash
# Purpose: Extract user-facing strings from UI source — JSX text nodes,
#          `aria-label`, `placeholder`, `title`. Deterministic extraction so
#          the LLM doesn't re-derive what counts as "user-visible copy."
#
# Usage:   bash scripts/extract-user-strings.sh [search-root]
#          Default search-root: src
#
# Output:  TSV rows to stdout:
#            <category>\t<file>:<line>\t<string>
#          Where <category> ∈ jsx-text | aria-label | placeholder | title.
#          The <string> is the literal value (without quotes).
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
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

# aria-label="…" / aria-label='…'
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

# placeholder="…"
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

# title="…" (HTML title attribute, not <title>)
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

# JSX text nodes: >Text</  or  >Text<
# Limited heuristic — picks up `>...<` segments with non-trivial content.
# The awk regex avoids {n,m} intervals (mawk, Debian's default awk, does not
# support them) and the [A-Z] range (collates as aBcD… under POSIX locales);
# the 81-char cap from the grep prefilter is enforced via length() instead.
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
