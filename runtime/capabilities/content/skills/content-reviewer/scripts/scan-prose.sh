#!/usr/bin/env bash
# Purpose: Find common prose issues in a draft. LLM still confirms severity.
# Usage:   bash scripts/scan-prose.sh <file>   (or stdin)
# Output:  smell | line | excerpt
# Exits:   0 ok | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat); src='/dev/stdin'
elif [ -f "$1" ]; then body=$(cat "$1"); src="$1"
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

scan() {
  pat="$1"; smell="$2"
  printf '%s\n' "$body" | { grep -nEi "$pat" 2>/dev/null || true; } \
    | head -20 \
    | awk -v s="$smell" -F: '{ excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
        gsub(/[ \t]+/, " ", excerpt);
        printf "%s | %s | %s\n", s, $1, substr(excerpt,1,160) }'
}

printf 'smell | line | excerpt\n'
scan '\b(very|really|just|simply|quite|basically|literally|actually)\b' 'filler-word'
scan '\b(might|maybe|could be|seems|appears to|kind of|sort of)\b' 'hedge'
scan '\b(was|were|been|being|is|are) [a-z]+ed\b' 'passive-voice-candidate'
scan '\bsynergy|leverage|utilize|paradigm|robust solution\b' 'jargon'
scan '\b[Tt]his (system|tool|approach)\b' 'vague-this'
scan '.{180,}' 'long-line'
scan '\[[^]]*\]\(\)' 'empty-link'
scan '\bclick here\b' 'click-here-link-text'
