#!/usr/bin/env bash
# Purpose: Count the contract clauses in one design-system contract file.
#          A clause is one non-blank, non-heading, non-list-marker line that
#          isn't just whitespace. Deterministic counter so the tier-derivation
#          step (derive-tier.sh) doesn't have to re-count from prose every run.
# Usage:   bash scripts/count-clauses.sh <file>
# Output:  one TSV row to stdout: <file>\t<clause_count>
#          diagnostics to stderr; stdout stays parseable
# Exits:   0 ok (incl. missing file -> count 0)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
if [ -z "$file" ]; then
  printf 'error: file argument required\n' >&2
  printf 'usage: bash scripts/count-clauses.sh <file>\n' >&2
  exit 2
fi

if [ ! -f "$file" ]; then
  printf 'note: file not found: %s -> count 0\n' "$file" >&2
  printf '%s\t0\n' "$file"
  exit 0
fi

# A clause line: non-blank AND not pure heading marker AND not pure list bullet
# We accept lines that BEGIN with `- ` or `* ` as clauses (they carry content),
# but reject lines that are ONLY `-`, `*`, or markdown frontmatter delimiters.
count=$(awk '
  /^[[:space:]]*```/ { in_fence = !in_fence; next }   # code fence toggle (skip fence line itself)
  in_fence { next }                                   # skip everything inside a fence
  /^[[:space:]]*$/ { next }                           # blank
  /^[[:space:]]*#/ { next }                           # heading
  /^[[:space:]]*---[[:space:]]*$/ { next }            # frontmatter delim / hr
  /^[[:space:]]*[-*][[:space:]]*$/ { next }           # empty bullet
  { c++ } END { print c+0 }
' "$file")

printf '%s\t%d\n' "$file" "$count"
