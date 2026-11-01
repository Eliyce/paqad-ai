#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Validate cross-module-impact-scanner output.
Usage:   bash scripts/lint-output.sh <file>   (or stdin)
Exits:   0 clean | 1 issues | 2 usage error
USAGE
  exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

# The em dash form is still accepted from older output; the documented line uses a comma.
em=$'\xe2\x80\x94'
if grep -qE "^Cross-Module Impact: internal-only(,| ${em}) no consumers affected\\.\$" <<<"$body"; then
  printf 'ok\n'; exit 0
fi

grep -qE '^## Cross-Module Impact' <<<"$body" || say 'missing "## Cross-Module Impact"'
grep -qE '^### Impact Map'         <<<"$body" || say 'missing "### Impact Map"'
grep -qE '^\| Surface \| Type \| Consumer \| Severity \| Coordinated change \|' <<<"$body" \
  || say 'missing canonical Impact Map table header'

severities=$(printf '%s\n' "$body" \
  | tr -d '\r' \
  | grep '^|' \
  | grep -v 'Severity' \
  | grep -v -- '---' \
  | cut -d'|' -f5 \
  | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
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
