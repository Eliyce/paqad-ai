#!/usr/bin/env bash
# Purpose: Validate an adversarial-review output block.
# Usage:   bash scripts/lint-findings.sh <file>   (or stdin)
# Checks:  has "## Findings", every finding tagged with a severity from
#          {Critical, High, Medium, Low}, severities are non-increasing, each
#          finding has a "Required action:" segment.
# Output:  "ok" on stdout when clean, issues on stderr otherwise.
# Exits:   0 clean | 1 issues found | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
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
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Findings' <<<"$body" || say 'missing "## Findings" heading'

# Extract finding lines (lines starting with "- " under Findings).
findings=$(printf '%s\n' "$body" | awk '
  /^## Findings/ { in_f=1; next }
  /^## / && in_f { in_f=0 }
  in_f && /^- / { print }
')
[ -z "$findings" ] && say 'no finding bullets ("- ...") under "## Findings"'

# Check each finding has a severity tag and Required action.
ranks="Critical 1
High 2
Medium 3
Low 4"

last_rank=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  sev=$(printf '%s' "$line" | grep -Eo '\b(Critical|High|Medium|Low)\b' | head -1 || true)
  if [ -z "$sev" ]; then
    say "finding missing severity tag: $line"
    continue
  fi
  rank=$(printf '%s' "$ranks" | awk -v s="$sev" '$1==s {print $2}')
  if [ "$rank" -lt "$last_rank" ]; then
    say "severity out of order at: $line"
  fi
  last_rank="$rank"
  grep -qE 'Required action:' <<<"$line" || say "finding missing 'Required action:' segment: $line"
done <<EOF
$findings
EOF

if [ "$issues" -gt 0 ]; then exit 1; fi
printf 'ok\n'
