#!/usr/bin/env bash
# Purpose: Validate cross-module-impact-scanner output.
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

# Special-case: internal-only short circuit.
if printf '%s' "$body" | grep -qE '^Cross-Module Impact: internal-only — no consumers affected\.$'; then
  printf 'ok\n'; exit 0
fi

printf '%s' "$body" | grep -qE '^## Cross-Module Impact' || say 'missing "## Cross-Module Impact"'
printf '%s' "$body" | grep -qE '^### Impact Map'         || say 'missing "### Impact Map"'
printf '%s' "$body" | grep -qE '^\| Surface \| Type \| Consumer \| Severity \| Coordinated change \|' \
  || say 'missing canonical Impact Map table header'

# Severity tokens must come from the rubric.
severities=$(printf '%s\n' "$body" \
  | awk -F'|' '/^\|/ && $5 != "" && $5 !~ /Severity/ && $5 !~ /---/ {gsub(/[[:space:]]/,"",$5); print $5}')
while IFS= read -r s; do
  [ -z "$s" ] && continue
  case "$s" in
    breaking|additive|silent-shift|internal-only) ;;
    *) say "unknown severity in Impact Map: $s" ;;
  esac
done <<EOF
$severities
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
