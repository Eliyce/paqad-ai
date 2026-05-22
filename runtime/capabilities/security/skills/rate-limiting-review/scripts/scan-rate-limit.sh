#!/usr/bin/env bash
# Purpose: Find sensitive endpoints and check for rate-limit / throttle hints.
# Usage:   bash scripts/scan-rate-limit.sh [search-root]
# Output:  signal | file:line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-src}"
[ -d "$root" ] || { printf 'note: search root not found: %s\n' "$root" >&2; exit 0; }

scan() {
  pat="$1"; sig="$2"
  { grep -rEn --binary-files=without-match "$pat" "$root" 2>/dev/null || true; } \
    | head -25 \
    | awk -v s="$sig" -F: '{ excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i;
        gsub(/[ \t]+/, " ", excerpt);
        printf "%s | %s:%s | %s\n", s, $1, $2, substr(excerpt,1,160) }'
}

printf 'signal | file:line | excerpt\n'
# Sensitive endpoints
scan '/(login|register|signup|reset[-_]?password|forgot[-_]?password|verify[-_]?otp|resend[-_]?otp|verify[-_]?email)' 'auth-endpoint'
scan '/(export|bulk|download|import|batch)' 'bulk-endpoint'
scan '/api/.*\b(search|preview|render)\b' 'expensive-endpoint-candidate'
scan '@websocket|on\(.connection.|io\.on\(' 'websocket-handler'

# Rate-limit signals (presence is good — listed for the LLM to cross-check)
scan '\b(throttle|rate_?limit|RateLimit|RateLimiter|limiter|express-rate-limit|slowdown)\b' 'rate-limit-present'
scan '\bper_?page|page_?size|limit\b[[:space:]]*[:=]' 'pagination-param-candidate'
