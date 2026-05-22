#!/usr/bin/env bash
# Purpose: Validate RCA output: 7 canonical sections in fixed order.
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

required=(
  '## Problem Statement'
  '## Symptoms & Impact'
  '## Timeline'
  '## Evidence'
  '## Root Cause'
  '## Contributing Factors'
  '## Solution'
  '## Verification & Follow-Up'
)

# Each section must be present and in this exact order.
last_line=0
for h in "${required[@]}"; do
  hp=$(printf '%s\n' "$body" | grep -nF -- "$h" | grep -E ":${h}\$" | head -1 || true)
  if [ -z "$hp" ]; then
    say "missing \"${h}\""
    continue
  fi
  ln=$(printf '%s' "$hp" | cut -d: -f1)
  if [ "$ln" -le "$last_line" ]; then
    say "section out of order: ${h}"
  fi
  last_line="$ln"
done

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
