#!/usr/bin/env bash
# Purpose: Match raw request text against assets/routing-rules.txt and emit
#          the canonical YAML routing decision.
# Usage:   bash scripts/route-request.sh                  (text on stdin)
#          bash scripts/route-request.sh "request text"
# Output:  YAML lines: workflow / reason / matched_rule  (or workflow: none).
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi

if [ -n "${1:-}" ]; then text="$1"; else text=$(cat); fi
lc=$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')

dir="$(cd "$(dirname "$0")" && pwd)"
rules="$dir/../assets/routing-rules.txt"
[ -f "$rules" ] || { printf 'error: rules file missing: %s\n' "$rules" >&2; exit 1; }

best_priority=-1
best_pat_len=-1
best_workflow=""
best_pattern=""

while IFS=$'\t' read -r prio workflow pattern; do
  case "$prio" in ''|\#*) continue ;; esac
  case "$lc" in
    *"$pattern"*)
      plen=${#pattern}
      if [ "$prio" -gt "$best_priority" ] \
         || { [ "$prio" -eq "$best_priority" ] && [ "$plen" -gt "$best_pat_len" ]; }; then
        best_priority="$prio"
        best_pat_len="$plen"
        best_workflow="$workflow"
        best_pattern="$pattern"
      fi
      ;;
  esac
done < "$rules"

if [ -z "$best_workflow" ]; then
  printf 'workflow: none\n'
  printf 'reason: no routing rule matched\n'
  exit 0
fi

printf 'workflow: %s\n' "$best_workflow"
printf 'reason: matched rule at priority %s\n' "$best_priority"
printf 'matched_rule: "%s"\n' "$best_pattern"
