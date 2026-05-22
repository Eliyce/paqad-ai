#!/usr/bin/env bash
# Purpose: Locate module docs that describe stateful workflows/approvals/transitions.
# Usage:   bash scripts/find-workflow-docs.sh [docs-root]
#          Default docs-root: docs/modules
# Output:  Sorted unique paths to candidate workflow/state docs.
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-docs/modules}"
[ -d "$root" ] || { printf 'note: docs root not found: %s\n' "$root" >&2; exit 0; }

{
  # Filenames likely to describe workflows.
  find "$root" -type f -name '*.md' 2>/dev/null \
    | { grep -Ei '/(workflow|workflows|state|states|approval|approvals|transitions|business)\.md$' || true; }

  # Also scan content for state-machine-like vocabulary.
  find "$root" -type f -name '*.md' 2>/dev/null \
    | xargs grep -lE '\b(state[[:space:]]+machine|transition|approve|reject|refund|charge|invite|export)\b' 2>/dev/null \
    || true
} | sort -u
