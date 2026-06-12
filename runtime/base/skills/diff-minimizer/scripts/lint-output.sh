#!/usr/bin/env bash
# Purpose: Validate diff-minimizer output: required sections, valid
#          classifications, and "Open Questions: none" exactness.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Diff Minimization' <<<"$body" || say 'missing "## Diff Minimization"'
grep -qE '^### Step Map'         <<<"$body" || say 'missing "### Step Map"'
grep -qE '^\| # \| Step \| Classification \| Mapped AC \| Action \|' <<<"$body" \
  || say 'Step Map missing canonical 5-column header'
grep -qE '^### Recommended Drops'      <<<"$body" || say 'missing "### Recommended Drops"'
grep -qE '^### Necessary Setup'        <<<"$body" || say 'missing "### Necessary Setup"'
grep -qE '(^Open Questions: none$|^### Open Questions)' <<<"$body" \
  || say 'missing Open Questions section or exact "Open Questions: none" line'

# Classifications must be exactly one of the four allowed values.
classes=$(printf '%s\n' "$body" | awk -F'|' '/^\|/ && $4 != "" && $4 !~ /Classification/ && $4 !~ /---/ {gsub(/[[:space:]]/,"",$4); print $4}')
while IFS= read -r c; do
  [ -z "$c" ] && continue
  case "$c" in
    ac-satisfying|necessary-setup|scaffolding|over-build) ;;
    *) say "unknown classification: $c" ;;
  esac
done <<EOF
$classes
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
