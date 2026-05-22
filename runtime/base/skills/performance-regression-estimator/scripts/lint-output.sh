#!/usr/bin/env bash
# Purpose: Validate performance-regression-estimator output.
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

# Empty short-circuit.
if printf '%s' "$body" | grep -qE '^Performance Hazards: none detected\.$'; then
  printf 'ok\n'; exit 0
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$body" | grep -qE '^## Performance Hazards' || say 'missing "## Performance Hazards"'
printf '%s' "$body" | grep -qE '^### Hazard Map' || say 'missing "### Hazard Map"'
printf '%s' "$body" | grep -qE '^\| # \| Hazard \| Path \| On hot path\? \| Severity \| Remediation \|' \
  || say 'Hazard Map missing canonical 6-column header'
printf '%s' "$body" | grep -qE '^### Recommended Pre-Merge Actions' || say 'missing "### Recommended Pre-Merge Actions"'

# Severity must be high|medium|low.
sev=$(printf '%s\n' "$body" | awk -F'|' '/^\|/ && $6 != "" && $6 !~ /Severity/ && $6 !~ /---/ {gsub(/[[:space:]]/,"",$6); print $6}')
while IFS= read -r s; do
  [ -z "$s" ] && continue
  case "$s" in
    high|medium|low) ;;
    *) say "unknown severity: $s" ;;
  esac
done <<EOF
$sev
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
