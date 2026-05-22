#!/usr/bin/env bash
# Purpose: Locate per-module integration docs that describe consumers.
# Usage:   bash scripts/find-integration-docs.sh [docs-modules-root]
#          Default: docs/modules
# Output:  Sorted unique paths to events.md, contracts.md, integration.md.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-docs/modules}"
[ -d "$root" ] || { printf 'note: not found: %s\n' "$root" >&2; exit 0; }
find "$root" -type f -name '*.md' 2>/dev/null \
  | { grep -E '/(events|contracts|integration|integrations)\.md$' || true; } \
  | sort -u
