#!/usr/bin/env bash
# Purpose: Map a list of changed files to candidate canonical doc paths
#          that may now be stale. LLM still confirms each.
# Usage:   bash scripts/detect-stale-docs.sh [docs-modules-root]
#          Stdin: one changed file path per line.
# Output:  Sorted unique candidate canonical doc paths.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
docs_root="${1:-docs/modules}"
[ -d "$docs_root" ] || { printf 'note: docs root not found: %s\n' "$docs_root" >&2; exit 0; }

# Collect existing canonical doc paths once.
canonical=$(find "$docs_root" -type f -name '*.md' \
  \( -name 'README.md' -o -name 'endpoints.md' -o -name 'schemas.md' \
     -o -name 'error-codes.md' -o -name 'events.md' -o -name 'contracts.md' \
     -o -name 'state.md' -o -name 'workflows.md' \) 2>/dev/null \
  | sort -u)

emit() { printf '%s\n' "$1"; }

while IFS= read -r changed; do
  [ -z "$changed" ] && continue
  case "$changed" in
    docs/*) emit "$changed"; continue ;;
  esac
  # Match each canonical doc whose module segment appears in the changed path.
  while IFS= read -r doc; do
    [ -z "$doc" ] && continue
    module=$(printf '%s' "$doc" | sed -E "s|^${docs_root}/([^/]+)/.*|\\1|")
    case "$changed" in
      *"/$module/"*|*"/$module."*) emit "$doc" ;;
    esac
  done <<EOF
$canonical
EOF
done | sort -u
