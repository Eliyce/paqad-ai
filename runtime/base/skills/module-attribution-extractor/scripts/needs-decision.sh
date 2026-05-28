#!/usr/bin/env bash
# Purpose: Read an extractor JSON report and decide whether a Decision Pause
#          packet is required.
# Usage:   bash scripts/needs-decision.sh <report.json>   (or stdin)
# Output:  Number of candidates in needs_decision on stdout.
#          On zero candidates, the literal `extractor: no-decision-needed`
#          is written to stderr so callers can fall through to the inferencer.
# Exits:   0 packet required (needs_decision is non-empty)
#          1 no decision needed (empty)
#          2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

count=$(printf '%s' "$body" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    const n = Array.isArray(j.needs_decision) ? j.needs_decision.length : 0;
    process.stdout.write(String(n));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});')

printf '%s\n' "$count"
if [ "$count" -gt 0 ]; then exit 0; fi
printf 'extractor: no-decision-needed\n' >&2
exit 1
