#!/usr/bin/env bash
# Purpose: Enumerate which design-system contract files exist and which are empty.
# Usage:   bash scripts/list-contract-files.sh [contract-dir]
#          Default contract-dir: docs/instructions/design-system
# Output:  one TSV row per expected file: path<TAB>present<TAB>empty
# Exits:   0 always (a missing dir is a valid finding for the LLM)
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-docs/instructions/design-system}"
files=(tokens.md components.md accessibility.md responsive.md motion.md patterns.md)

for f in "${files[@]}"; do
  path="$root/$f"
  if [ -f "$path" ]; then
    if [ -s "$path" ] && grep -qE '\S' "$path"; then
      printf '%s\tpresent\tnon-empty\n' "$path"
    else
      printf '%s\tpresent\tempty\n' "$path"
    fi
  else
    printf '%s\tabsent\tempty\n' "$path"
  fi
done
