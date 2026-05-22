#!/usr/bin/env bash
# Purpose: Pattern-scan a spec for known defect classes the LLM should
#          investigate. Skips lines under "Open Questions" and TBD lines.
# Usage:   bash scripts/scan-defects.sh <spec.md>
# Output:  category | line | excerpt
# Exits:   0 ok | 1 missing input | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
spec="${1:-}"
[ -f "$spec" ] || { printf 'error: spec not found: %s\n' "$spec" >&2; exit 1; }

# Strip "## Open Questions" sections and TBD lines.
filtered=$(awk '
  /^## Open Questions/ { skip=1; next }
  /^## / { skip=0 }
  skip { next }
  /\b(TBD|to be determined)\b/ { next }
  { print NR ":" $0 }
' "$spec")

emit() {
  cat="$1"; pat="$2"
  printf '%s\n' "$filtered" | { grep -Ei "$pat" 2>/dev/null || true; } \
    | head -25 \
    | awk -v c="$cat" -F: '{ excerpt=""; for (i=2; i<=NF; i++) excerpt = excerpt (i==2?"":":") $i;
        gsub(/[ \t]+/, " ", excerpt);
        printf "%s | %s | %s\n", c, $1, substr(excerpt,1,160) }'
}

printf 'category | line | excerpt\n'
emit 'vague-quantifier' '\b(some|many|several|reasonable|appropriate|sufficient|fast enough|low latency|high performance)\b'
emit 'missing-actor'    '\b(the system|it should|will be|is responsible)\b'
emit 'unbounded-modal'  '\b(may|might|could|should usually|typically)\b'
emit 'tbd-leak'         '\b(TODO|FIXME|XXX|placeholder)\b'
emit 'dangling-ref'     '\bsee section [A-Z0-9.]+|figure [0-9]+\b'
emit 'goal-collision'   '\b(however|but also|except when|unless)\b'
emit 'no-negative'      '^### AC-[0-9]+(\.[0-9]+)?\b'   # informational; LLM verifies if a negative AC exists per FR
