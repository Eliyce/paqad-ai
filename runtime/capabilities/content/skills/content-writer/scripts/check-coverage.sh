#!/usr/bin/env bash
# Purpose: Confirm every "Outline" section heading in the brief appears as
#          a heading in the draft.
# Usage:   bash scripts/check-coverage.sh <brief> <draft>
# Output:  "ok" when covered; missing sections on stderr.
# Exits:   0 ok | 1 missing | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] && [ -f "${2:-}" ] || { printf 'usage: %s <brief> <draft>\n' "$0" >&2; exit 2; }
brief="$1"; draft="$2"

# Extract numbered outline items: "1. Section name — purpose"
sections=$(awk '/^## Outline/{f=1;next} /^## /{f=0} f && /^[0-9]+\.[[:space:]]/' "$brief" \
  | sed -E 's/^[0-9]+\.[[:space:]]*//' \
  | sed -E 's/[[:space:]]+—.*$//' \
  | sed -E 's/[[:space:]]+$//')

issues=0
while IFS= read -r s; do
  [ -z "$s" ] && continue
  if ! grep -qF "$s" "$draft"; then
    printf 'missing in draft: %s\n' "$s" >&2
    issues=$((issues+1))
  fi
done <<EOF
$sections
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
