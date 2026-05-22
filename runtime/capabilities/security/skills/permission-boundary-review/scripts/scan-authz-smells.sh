#!/usr/bin/env bash
# Purpose: Pattern-scan for authorization weaknesses.
# Usage:   bash scripts/scan-authz-smells.sh [search-root]
# Output:  smell | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-src}"
[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

scan() {
  pat="$1"; smell="$2"
  { grep -rEn --binary-files=without-match "$pat" "$root" 2>/dev/null || true; } \
    | head -25 \
    | awk -v s="$smell" -F: '{ excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i;
        gsub(/[ \t]+/, " ", excerpt);
        printf "%s | %s:%s | %s\n", s, $1, $2, substr(excerpt,1,160) }'
}

printf 'smell | file:line | excerpt\n'
scan '\.(findById|find|get)\([^)]*req\.(params|query|body)' 'lookup-by-user-id-no-authz'
scan 'role[[:space:]]*===?[[:space:]]*["'"'"']admin["'"'"']' 'string-compare-role-admin'
scan '/admin/|/debug/|/internal/' 'admin-path-candidate'
scan 'impersonate|sudo[_-]?as|loginAs' 'impersonation-call'
scan 'export.*(all|csv|excel|dump)' 'broad-export-candidate'
scan 'tenant[_-]?id|workspace[_-]?id|account[_-]?id' 'tenant-key-usage'
scan '\.where\(\{[^}]*tenant_id|tenant_id[[:space:]]*=' 'tenant-scoped-query'
