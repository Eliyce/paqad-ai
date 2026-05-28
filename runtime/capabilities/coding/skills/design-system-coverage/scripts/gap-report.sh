#!/usr/bin/env bash
# Purpose: Emit `DT-DS-XXXX` finding rows for gaps in the design-system contract
#          itself — files absent, files empty, namespaces missing. Used when the
#          tier is `bare` (the workflow runs anyway but the contract gets graded).
#
# Usage:   bash scripts/gap-report.sh [contract-dir]
#          Default contract-dir: docs/instructions/design-system
#
# Output:  one TSV row per gap to stdout:
#          DT-DS-<NNNN>\t<category>\t<severity>\t<contract_ref>\t<description>
#          diagnostics to stderr
#
# Categories: missing-file | empty-file
# Severity:   medium  (the contract is the contract; gaps default to medium)
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-docs/instructions/design-system}"
files=(tokens.md components.md accessibility.md responsive.md motion.md patterns.md)

# Use a deterministic id sequence so a re-run on the same contract emits the
# same ids — the LLM can match them across runs.
i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  path="$root/$f"
  id=$(printf 'DT-DS-%04d' "$i")
  if [ ! -f "$path" ]; then
    printf '%s\tmissing-file\tmedium\t%s\tcontract file is absent; create %s to declare %s\n' \
      "$id" "$path" "$f" "${f%.md}"
  elif [ ! -s "$path" ] || ! grep -qE '\S' "$path"; then
    printf '%s\tempty-file\tmedium\t%s\tcontract file exists but is empty; add at least one clause\n' \
      "$id" "$path"
  fi
done
