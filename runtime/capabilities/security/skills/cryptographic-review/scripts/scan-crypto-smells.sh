#!/usr/bin/env bash
# Purpose: Pattern-scan source for known cryptographic anti-patterns.
# Usage:   bash scripts/scan-crypto-smells.sh [search-root]
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
  { grep -rEni --binary-files=without-match "$pat" "$root" 2>/dev/null || true; } \
    | head -25 \
    | awk -v s="$smell" -F: '{ excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i;
        gsub(/[ \t]+/, " ", excerpt);
        printf "%s | %s:%s | %s\n", s, $1, $2, substr(excerpt,1,160) }'
}

printf 'smell | file:line | excerpt\n'
scan '\bMath\.random\(' 'insecure-prng-js'
scan '\brand\(\)|\bmt_rand\(' 'insecure-prng-php'
scan '\brandom\.random\(\)|java\.util\.Random' 'insecure-prng-py-java'
scan '\b(md5|sha1)\(' 'weak-hash-for-password-candidate'
scan 'aes[-_/]([0-9]+[-_/])?ecb|aes/ecb' 'aes-ecb-mode'
scan 'verify[[:space:]]*=[[:space:]]*[Ff]alse|rejectUnauthorized[[:space:]]*:[[:space:]]*false|InsecureSkipVerify[[:space:]]*:[[:space:]]*true' 'tls-verify-disabled'
scan 'CURLOPT_SSL_VERIFYPEER[[:space:]]*=[[:space:]]*[Ff]alse' 'tls-verify-disabled-curl'
scan 'NODE_TLS_REJECT_UNAUTHORIZED[[:space:]]*=[[:space:]]*0' 'tls-verify-disabled-node-env'
scan '_create_unverified_context\(' 'tls-verify-disabled-py'
scan '\b(api[_-]?key|secret|password|token)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9/_=+\-]{16,}["'"'"']' 'hardcoded-secret-candidate'
scan 'iv[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}["'"'"']' 'static-iv-candidate'
