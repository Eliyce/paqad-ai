#!/usr/bin/env bash
# Purpose: Grep the codebase for known auth anti-patterns the LLM should
#          investigate. Emits one row per hit; LLM still confirms each.
# Usage:   bash scripts/scan-auth-smells.sh [search-root]
#          Default search-root: src
# Output:  smell | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

scan() {
  pattern="$1"; smell="$2"
  { grep -rEn --binary-files=without-match "$pattern" "$root" 2>/dev/null || true; } \
    | head -50 \
    | awk -v s="$smell" -F: '
        { excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i;
          gsub(/[ \t]+/, " ", excerpt);
          printf "%s | %s:%s | %s\n", s, $1, $2, substr(excerpt,1,160) }'
}

printf 'smell | file:line | excerpt\n'
scan 'alg[[:space:]]*[:=][[:space:]]*["'\''"]?none' 'jwt-alg-none'
scan 'localStorage\.setItem\(.*[Tt]oken' 'token-in-localstorage'
scan 'sessionStorage\.setItem\(.*[Tt]oken' 'token-in-sessionstorage'
scan '\b(md5|sha1)\(' 'weak-hash'
scan 'bcrypt\.(genSalt|hash|genSaltSync|hashSync|compare)\([^)]*\b([1-9]|10)\b' 'bcrypt-cost-low'
scan 'jwt[._-]?secret[[:space:]]*[:=][[:space:]]*["'\''"](secret|password|key|123456|changeme)' 'weak-jwt-secret'
scan 'response_type[[:space:]]*=[[:space:]]*["'\''"]?token' 'oauth-implicit-flow'
scan 'redirect_uri[[:space:]]*=[[:space:]]*["'\''"]?\*' 'oauth-wildcard-redirect'
