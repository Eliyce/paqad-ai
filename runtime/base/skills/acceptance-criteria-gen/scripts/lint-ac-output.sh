#!/usr/bin/env bash
# Purpose: Validate a generated Acceptance Criteria markdown block.
# Usage:   bash scripts/lint-ac-output.sh <file>   (or pipe on stdin)
# Checks:  has "## Acceptance Criteria", every "### AC-..." has Given/When/Then,
#          ids unique, ids sorted, "## Coverage Notes" present.
# Output:  Issue list on stderr; "ok" on stdout when clean.
# Exits:   0 clean | 1 issues found | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  body=$(cat)
elif [ -f "$1" ]; then
  body=$(cat "$1")
else
  printf 'error: file not found: %s\n' "$1" >&2
  exit 2
fi

issues=0
say_issue() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Acceptance Criteria' <<<"$body" \
  || say_issue 'missing "## Acceptance Criteria" heading'

grep -qE '^## Coverage Notes' <<<"$body" \
  || say_issue 'missing "## Coverage Notes" section'

ids=$(printf '%s' "$body" | grep -Eo '^### AC-[0-9]+(\.[0-9]+)?' | awk '{print $2}')
[ -z "$ids" ] && say_issue 'no "### AC-..." criterion headings found'

dupes=$(printf '%s\n' "$ids" | sort | uniq -d)
[ -n "$dupes" ] && say_issue "duplicate AC ids: $(printf '%s' "$dupes" | tr '\n' ' ')"

# Verify each id has at least one of Given/When/Then in the lines after its heading.
# Capture into a variable so say_issue runs in this shell (not a subshell pipeline).
missing_ids=$(printf '%s' "$body" \
  | awk '
      /^### AC-/ {
        if (id != "" && !have) print id
        id=$2; have=0; next
      }
      id != "" {
        if (/^### |^## /) {
          if (!have) print id
          id=""; have=0
          next
        }
        if ($0 ~ /Given|When|Then/) have=1
      }
      END { if (id != "" && !have) print id }
    ')

while IFS= read -r missing_id; do
  [ -n "$missing_id" ] && say_issue "criterion $missing_id missing Given/When/Then prose"
done <<EOF
$missing_ids
EOF

if [ "$issues" -gt 0 ]; then
  exit 1
fi
printf 'ok\n'
