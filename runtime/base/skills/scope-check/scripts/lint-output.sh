#!/usr/bin/env bash
# Purpose: Validate scope-check output. Decision must be exactly one of the
#          three allowed values; required sections present.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

for h in '## Scope Decision' '## Spec Evidence' '## Required Next Step'; do
  printf '%s' "$body" | grep -qE "^${h}\$" || say "missing \"${h}\""
done

dec=$(printf '%s\n' "$body" | awk '/^## Scope Decision/{f=1;next} /^## /{f=0} f' | grep -oE 'within-scope|extension-needed|blocked-no-spec' | head -1 || true)
case "$dec" in
  within-scope|extension-needed|blocked-no-spec) ;;
  *) say 'Scope Decision must start with within-scope | extension-needed | blocked-no-spec' ;;
esac

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
