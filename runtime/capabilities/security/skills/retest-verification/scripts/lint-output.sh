#!/usr/bin/env bash
# Purpose: Validate retest output. Status must be fixed | still-open |
#          needs-manual-verification; no invented ids.
# Usage:   bash scripts/lint-output.sh <retest.md> <source-sidecar.json>
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] && [ -f "${2:-}" ] || { printf 'usage: %s <retest.md> <source-sidecar.json>\n' "$0" >&2; exit 2; }

retest=$(cat "$1")
source_ids=$(node -e '
const fs = require("fs");
const arr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const f of arr) console.log(f.id);
' "$2")

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

printf '%s' "$retest" | grep -qE '^## Retest Decisions' || say 'missing "## Retest Decisions"'

# Each retest entry like: "### PT-... → fixed|still-open|needs-manual-verification"
entries=$(printf '%s\n' "$retest" | grep -E '^### ')
while IFS= read -r line; do
  [ -z "$line" ] && continue
  id=$(printf '%s' "$line" | grep -oE 'PT-[A-Za-z0-9_-]+' | head -1)
  status=$( { printf '%s' "$line" | grep -oE '(^|[^a-zA-Z-])(fixed|still-open|needs-manual-verification)([^a-zA-Z-]|$)' || true; } | { grep -oE 'fixed|still-open|needs-manual-verification' || true; } | head -1)
  if [ -z "$id" ] || [ -z "$status" ]; then say "malformed entry: $line"; continue; fi
  printf '%s\n' "$source_ids" | grep -qx "$id" || say "invented id (not in source): $id"
done <<EOF
$entries
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
