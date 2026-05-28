#!/usr/bin/env bash
# Purpose: Grep UI source for likely a11y violations that don't need a running
#          browser to detect. Each hit is an investigation candidate (the LLM
#          still confirms); the deterministic part is "find the suspect lines."
#
# Usage:   bash scripts/static-a11y-scan.sh [search-root]
#          Default search-root: src
#
# Output:  TSV rows to stdout: <category>\t<file>:<line>\t<excerpt>
#          Diagnostics to stderr.
#
# Categories detected:
#   img-no-alt              <img ...> with no `alt=`
#   button-no-name          <button> with no text + no aria-label
#   anchor-no-name          <a href ...> with no text + no aria-label
#   input-no-label          <input> with no aria-label / aria-labelledby
#   outline-zero            outline: 0 / outline: none with no replacement nearby
#   positive-tabindex       tabindex="1" or > 0
#   missing-lang            <html ...> with no `lang=`
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  exit 0
fi

exclude=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude='*.test.*'
  --exclude='*.spec.*'
  --exclude='*.stories.*'
  --exclude='*.snap'
)

emit() {
  category="$1"; pattern="$2"
  { grep -rEn --binary-files=without-match "${exclude[@]}" "$pattern" "$root" 2>/dev/null || true; } \
    | head -200 \
    | awk -v c="$category" -F: '
        { excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
          gsub(/[ \t]+/, " ", excerpt)
          printf "%s\t%s:%s\t%s\n", c, $1, $2, substr(excerpt,1,140) }'
}

# img-no-alt — <img ...> where the same tag has no `alt=`
{ grep -rEn --binary-files=without-match "${exclude[@]}" '<img[^>]*>' "$root" 2>/dev/null || true; } \
  | head -200 \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (excerpt !~ /alt=/) {
        gsub(/[ \t]+/, " ", excerpt)
        printf "img-no-alt\t%s:%s\t%s\n", $1, $2, substr(excerpt, 1, 140)
      }
    }'

# button-no-name — <button ... /> self-close or <button>{}</button> with no
# text content and no aria-label.
{ grep -rEn --binary-files=without-match "${exclude[@]}" '<button[^>]*/>' "$root" 2>/dev/null || true; } \
  | head -200 \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (excerpt !~ /aria-label(elledby)?=/) {
        gsub(/[ \t]+/, " ", excerpt)
        printf "button-no-name\t%s:%s\t%s\n", $1, $2, substr(excerpt, 1, 140)
      }
    }'

# anchor-no-name — <a href=... ></a> with empty body and no aria-label.
{ grep -rEn --binary-files=without-match "${exclude[@]}" '<a [^>]*href=' "$root" 2>/dev/null || true; } \
  | head -200 \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (excerpt ~ /><\/a>/ && excerpt !~ /aria-label/) {
        gsub(/[ \t]+/, " ", excerpt)
        printf "anchor-no-name\t%s:%s\t%s\n", $1, $2, substr(excerpt, 1, 140)
      }
    }'

# input-no-label
{ grep -rEn --binary-files=without-match "${exclude[@]}" '<input[^>]*>' "$root" 2>/dev/null || true; } \
  | head -200 \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      # Skip hidden/submit-like inputs.
      if (excerpt ~ /type=("|'\'')(hidden|submit|button|reset)("|'\'')/) next
      if (excerpt !~ /aria-label(elledby)?=/ && excerpt !~ /id=/) {
        gsub(/[ \t]+/, " ", excerpt)
        printf "input-no-label\t%s:%s\t%s\n", $1, $2, substr(excerpt, 1, 140)
      }
    }'

emit outline-zero    'outline[[:space:]]*:[[:space:]]*(0|none)'
# Match both HTML `tabindex=` and JSX `tabIndex=` (case-insensitive attribute name).
emit positive-tabindex '[Tt]ab[Ii]ndex[[:space:]]*=[[:space:]]*"?[1-9]'

# missing-lang — <html ...> with no lang=
{ grep -rEn --binary-files=without-match "${exclude[@]}" '<html\b' "$root" 2>/dev/null || true; } \
  | awk -F: '{
      excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
      if (excerpt !~ /lang=/) {
        gsub(/[ \t]+/, " ", excerpt)
        printf "missing-lang\t%s:%s\t%s\n", $1, $2, substr(excerpt, 1, 140)
      }
    }'
