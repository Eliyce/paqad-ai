#!/usr/bin/env bash
# Purpose: Route a list of canonical doc paths (one per line on stdin) to
#          per-domain delegate buckets: api | integration | error | glossary | canonical.
# Usage:   bash scripts/route-paths.sh
# Output:  "<domain>\t<path>" per line, sorted, dedup. Most-specific match wins.
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi

while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    *"/api/endpoints.md"|*"/api/schemas.md"|*"/api/error-codes.md") domain=api ;;
    *"/events.md"|*"/contracts.md"|*"/integration.md"|*"/integrations.md") domain=integration ;;
    *"/error-codes.md") domain=error ;;
    *"/glossary.md"|*"glossary"*) domain=glossary ;;
    *) domain=canonical ;;
  esac
  printf '%s\t%s\n' "$domain" "$p"
done | sort -u
