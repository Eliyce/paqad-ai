#!/usr/bin/env bash
# Purpose: Validate workflow-router output. Either workflow:none with reason,
#          or a workflow line + reason + matched_rule.
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

if grep -qE '^workflow: none$' <<<"$body"; then
  grep -qE '^reason:' <<<"$body" || say 'workflow:none must include "reason:"'
else
  grep -qE '^workflow: [a-z][a-z0-9-]+$' <<<"$body" || say 'missing canonical workflow line'
  grep -qE '^reason:' <<<"$body" || say 'missing reason: line'
  grep -qE '^matched_rule:' <<<"$body" || say 'missing matched_rule: line'
fi

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
