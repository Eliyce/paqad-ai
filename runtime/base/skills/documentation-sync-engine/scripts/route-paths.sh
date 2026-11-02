#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Route a list of canonical doc paths (one per line on stdin) to
         per-domain delegate buckets: api | integration | error | glossary | canonical.
Usage:   bash scripts/route-paths.sh
Output:  "<domain>\t<path>" per line, sorted, dedup. Most-specific match wins.
USAGE
  exit 0
fi

routed=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  routed=1
  case "$p" in
    *"/api/endpoints.md"|*"/api/schemas.md"|*"/api/error-codes.md") domain=api ;;
    *"/events.md"|*"/contracts.md"|*"/integration.md"|*"/integrations.md") domain=integration ;;
    *"/error-codes.md") domain=error ;;
    *"/glossary.md"|*"glossary"*) domain=glossary ;;
    *) domain=canonical ;;
  esac
  printf '%s\t%s\n' "$domain" "$p"
done > >(LC_ALL=C sort -u)
wait
[ "$routed" -eq 1 ] || echo "note: no doc paths on stdin" >&2
