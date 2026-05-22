#!/usr/bin/env bash
# Purpose: Pattern-scan for known injection / unsafe-input sinks.
# Usage:   bash scripts/scan-injection-smells.sh [search-root]
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
scan 'child_process\.(exec|execSync)\(|subprocess\.(run|Popen)\([^)]*shell[[:space:]]*=[[:space:]]*True' 'shell-exec-with-input'
scan '\bexec\(|\bsystem\(|\bpassthru\(' 'shell-exec-builtin'
scan 'dangerouslySetInnerHTML|v-html|\{!![[:space:]]|\|raw\b|render_template_string\(' 'unsafe-template-render'
scan '\bunserialize\(|pickle\.loads\(|yaml\.load\([^)]*[^,)]+[[:space:]]*\)' 'unsafe-deserialize'
scan 'lodash\.merge\(|_\.merge\(|_\.defaults\(' 'js-deep-merge-pollution-candidate'
scan '\$_(GET|POST|REQUEST|COOKIE|FILES)\b' 'php-superglobal-direct-use'
scan '\bSELECT[[:space:]]+\*[[:space:]]+FROM\b.*\$' 'sql-string-interp-candidate'
scan 'fetch\(|axios\.(get|post)\(|requests\.(get|post|request)\(' 'outbound-http-with-input-candidate'
scan 'fillable[[:space:]]*=|guarded[[:space:]]*=|\.create\(req\.body|\.update\(req\.body' 'mass-assignment-candidate'
scan '\([a-z]+[+*]\)[+*]|\.\*\.\*|\(.+\|.+\)[+*]' 'redos-pattern-candidate'
