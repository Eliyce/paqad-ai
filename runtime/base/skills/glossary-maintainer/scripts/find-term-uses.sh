#!/usr/bin/env bash
# Purpose: Find usages of a term across docs, AC ids, API endpoints, and source files.
# Usage:   bash scripts/find-term-uses.sh "<term>"
# Output:  "<kind>\t<reference>" per line, sorted unique. Kind ∈
#          {ac-id, api-endpoint, schema-column, doc-file, source-file}.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -n "${1:-}" ] || { printf 'usage: %s "<term>"\n' "$0" >&2; exit 2; }
term="$1"
escaped=$(printf '%s' "$term" | sed -E 's/[][()|?+*^$.\\]/\\&/g')

# AC ids that co-occur with the term in spec/AC docs.
if [ -d .paqad/specs ]; then
  matches=$( { grep -lEi "$escaped" .paqad/specs/*.md 2>/dev/null || true; } )
  if [ -n "$matches" ]; then
    printf '%s\n' "$matches" | xargs grep -hEo 'AC-[0-9]+(\.[0-9]+)?' 2>/dev/null \
      | sort -u | while IFS= read -r id; do printf 'ac-id\t%s\n' "$id"; done
  fi
fi

# Doc files mentioning the term.
if [ -d docs ]; then
  { grep -rlEi --include='*.md' "$escaped" docs 2>/dev/null || true; } \
    | sort -u | while IFS= read -r p; do [ -n "$p" ] && printf 'doc-file\t%s\n' "$p"; done
fi

# Source files mentioning it.
if [ -d src ]; then
  { grep -rlEi "$escaped" src 2>/dev/null || true; } \
    | head -100 | sort -u | while IFS= read -r p; do [ -n "$p" ] && printf 'source-file\t%s\n' "$p"; done
fi

# API endpoints in endpoints.md docs that mention the term.
if [ -d docs ]; then
  endpoints_files=$(find docs -type f -name 'endpoints.md' 2>/dev/null)
  if [ -n "$endpoints_files" ]; then
    printf '%s\n' "$endpoints_files" | xargs grep -hEi "(GET|POST|PUT|PATCH|DELETE)[[:space:]]+/[A-Za-z0-9_/{}-]+" 2>/dev/null \
      | { grep -Ei "$escaped" || true; } \
      | { grep -oE "(GET|POST|PUT|PATCH|DELETE)[[:space:]]+/[A-Za-z0-9_/{}-]+" || true; } \
      | sort -u | while IFS= read -r e; do [ -n "$e" ] && printf 'api-endpoint\t%s\n' "$e"; done
  fi
fi
