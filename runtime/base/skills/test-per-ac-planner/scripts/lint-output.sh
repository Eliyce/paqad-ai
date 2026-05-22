#!/usr/bin/env bash
# Purpose: Validate test-per-ac-planner output. Each AC subsection has a
#          5-column table; T-id parent matches AC.
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

printf '%s' "$body" | grep -qE '^## Verification Plan' || say 'missing "## Verification Plan"'
printf '%s' "$body" | grep -qE '^## Uncovered Criteria' || say 'missing "## Uncovered Criteria"'

# Each AC subsection must have the canonical 5-column header.
sections=$(printf '%s' "$body" | grep -cE '^### AC-' || true)
tables=$(printf '%s' "$body" | grep -cE '^\| Test ID \| Layer \| File \| Case \| Notes \|' || true)
[ "${sections:-0}" -gt 0 ] && [ "${tables:-0}" -lt "${sections:-0}" ] \
  && say "fewer canonical 5-column tables (${tables:-0}) than AC subsections (${sections:-0})"

# T-id parent vs AC parent check for the simple case.
node -e '
const txt = process.argv[1];
const re = /^### (AC-(\d+(?:\.\d+)?))[^\n]*$/gm;
let m, bad = [];
while ((m = re.exec(txt)) !== null) {
  const ac = m[2];
  // Capture the next ### or end-of-doc block.
  const start = m.index + m[0].length;
  const next = txt.slice(start).search(/\n### |\n## /);
  const block = next === -1 ? txt.slice(start) : txt.slice(start, start + next);
  const tids = [...block.matchAll(/T(\d+(?:\.\d+)?)/g)].map(x => x[1]);
  for (const tid of tids) if (!tid.startsWith(ac.split(".")[0])) bad.push("AC-" + ac + " has T-id T" + tid + " not under that AC");
}
if (bad.length) { for (const b of bad) console.error(b); process.exit(1); }
' "$body" || issues=$((issues+1))

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
