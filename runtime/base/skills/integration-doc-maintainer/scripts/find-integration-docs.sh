#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Locate per-module integration docs (events.md, contracts.md, integration*.md, jobs.md).
Usage:   bash scripts/find-integration-docs.sh [docs-modules-root]
Output:  Sorted unique paths.
USAGE
  exit 0
fi
root="${1:-docs/modules}"
[ -d "$root" ] || { echo "note: docs root not found: $root" >&2; exit 0; }
find "$root" -type f -name '*.md' 2>/dev/null \
  | { grep -E '/(events|contracts|jobs|integration|integrations)\.md$' || true; } \
  | LC_ALL=C sort -u
