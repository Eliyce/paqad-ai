#!/usr/bin/env bash
# Purpose: Validate a generated Acceptance Criteria markdown block (flat AC-N format).
# Usage:   bash scripts/lint-ac-output.sh <file>   (or pipe on stdin)
# Checks:  has "## Acceptance criteria", every "- AC-N:" line carries Given/When/Then and a
#          "(proof: automated|manual|visual)" tag, ids are flat and unique, "## Coverage
#          Notes" present. The flat AC-N shape is exactly what the freeze parser reads
#          (issue #512, C4), so a block passing this lint can never fail the freeze on shape.
# Output:  Issue list on stderr; "ok" on stdout when clean.
# Exits:   0 clean | 1 issues found | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
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

grep -qiE '^## Acceptance criteria' <<<"$body" \
  || say_issue 'missing "## Acceptance criteria" heading'

grep -qE '^## Coverage Notes' <<<"$body" \
  || say_issue 'missing "## Coverage Notes" section'

# Flat criterion lines: "- AC-N: ..." (bullet optional). A dotted AC-N.N is rejected — the
# freeze parser cannot ingest it, so it must never leave this skill.
crit_lines=$(printf '%s\n' "$body" | grep -E '^[[:space:]]*(([-*+][[:space:]]+))?AC-[0-9]+(\.[0-9]+)?[[:space:]]*:' || true)
[ -z "$crit_lines" ] && say_issue 'no "- AC-N: ..." criterion lines found'

# Any dotted id is a hard error (the mangled two-level shape #512/C4 removes). A here-string
# (not a pipe) into `grep -q` avoids the SIGPIPE+pipefail race the portability guard forbids.
if grep -qE 'AC-[0-9]+\.[0-9]+[[:space:]]*:' <<<"$crit_lines"; then
  say_issue 'dotted AC-N.N ids are not allowed — use flat AC-N (the freeze parser reads flat ids)'
fi

ids=$(printf '%s\n' "$crit_lines" | grep -Eo 'AC-[0-9]+' || true)
dupes=$(printf '%s\n' "$ids" | sort | uniq -d | { grep -v '^$' || true; })
[ -n "$dupes" ] && say_issue "duplicate AC ids: $(printf '%s' "$dupes" | tr '\n' ' ')"

# Each criterion line needs Given/When/Then and an explicit proof tag.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  id=$(grep -Eo 'AC-[0-9]+(\.[0-9]+)?' <<<"$line" | head -1)
  if ! grep -qiE 'given .*when .*then' <<<"$line"; then
    say_issue "criterion $id missing Given/When/Then prose"
  fi
  if ! grep -qiE '\(proof:[[:space:]]*(automated|manual|visual)\)' <<<"$line"; then
    say_issue "criterion $id missing a (proof: automated|manual|visual) tag"
  fi
done <<EOF
$crit_lines
EOF

if [ "$issues" -gt 0 ]; then
  exit 1
fi
printf 'ok\n'
