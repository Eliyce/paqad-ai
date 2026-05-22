#!/usr/bin/env bash
# Purpose: Pattern-scan source for logging anti-patterns.
# Usage:   bash scripts/scan-log-smells.sh [search-root]
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
scan '(log|logger|console)\.(info|warn|error|debug)\(.*(password|token|secret|api[_-]?key|ssn|credit[_-]?card|cvv)' 'sensitive-data-in-log'
scan '(log|logger)\.(info|warn|error)\([^)]*\$\{?(req|request)\.' 'log-injection-candidate'
scan '(log|logger)\.(info|warn|error)\([^)]*req\.body|request\.body' 'request-body-in-log'
scan 'set_audit|audit_log|auditLog' 'audit-log-call'
scan '(log|logger)\.(info|warn|error)\(.*\bemail\b' 'pii-email-in-log-candidate'
scan '\.(remove|delete)\([^)]*log' 'app-deletes-own-log-candidate'
