#!/usr/bin/env bash
# Purpose: Validate dependency-advisory-triage output. Each finding has the
#          required fields and no duplicate (ecosystem,package,advisory_id).
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

printf '%s' "$body" | grep -qE '^## Dependency Findings' || say 'missing "## Dependency Findings"'

# Each finding starts with "### <ecosystem>:<package> — <id>".
keys=$(printf '%s\n' "$body" | grep -E '^### ' | sed -E 's/^### //; s/[[:space:]]+—.*$//')
dupes=$(printf '%s\n' "$keys" | sort | uniq -d)
[ -n "$dupes" ] && say "duplicate finding keys: $(printf '%s' "$dupes" | tr '\n' ' ')"

count=$(printf '%s\n' "$keys" | grep -c '.' || true)
for needle in 'Severity:' 'Sources:' 'Installed:' 'Remediation:'; do
  hits=$(printf '%s' "$body" | grep -cE "^- \*\*${needle}" || true)
  [ "${hits:-0}" -lt "${count:-0}" ] && say "fewer '${needle}' lines (${hits:-0}) than findings (${count:-0})"
done

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
