#!/usr/bin/env bash
# Purpose: Locate per-module integration docs (events.md, contracts.md, integration*.md, jobs.md).
# Usage:   bash scripts/find-integration-docs.sh [docs-modules-root]
# Output:  Sorted unique paths.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-docs/modules}"
[ -d "$root" ] || exit 0
find "$root" -type f -name '*.md' 2>/dev/null \
  | { grep -E '/(events|contracts|jobs|integration|integrations)\.md$' || true; } \
  | sort -u
