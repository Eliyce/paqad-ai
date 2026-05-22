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

printf '%s' "$body" | grep -qE '^## Diff Minimization' || say 'missing "## Diff Minimization"'
printf '%s' "$body" | grep -qE '^### Step Map'         || say 'missing "### Step Map"'
printf '%s' "$body" | grep -qE '^\| # \| Step \| Classification \| Mapped AC \| Action \|' \
  || say 'Step Map missing canonical 5-column header'
printf '%s' "$body" | grep -qE '^### Recommended Drops'      || say 'missing "### Recommended Drops"'
printf '%s' "$body" | grep -qE '^### Necessary Setup'        || say 'missing "### Necessary Setup"'
printf '%s' "$body" | grep -qE '(^Open Questions: none$|^### Open Questions)' \
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
