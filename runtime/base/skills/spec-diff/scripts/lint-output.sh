#!/usr/bin/env bash
# Purpose: Validate spec-diff output. Decision must be exactly covered|extension|conflict.
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

for h in '## Spec Diff Decision' '## Evidence' '## Implication'; do
  grep -qE "^${h}\$" <<<"$body" || say "missing \"${h}\""
done

dec=$(printf '%s\n' "$body" | awk '/^## Spec Diff Decision/{f=1;next} /^## /{f=0} f' | grep -oE 'covered|extension|conflict' | head -1 || true)
case "$dec" in covered|extension|conflict) ;; *) say 'Spec Diff Decision must start with covered | extension | conflict' ;; esac

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
