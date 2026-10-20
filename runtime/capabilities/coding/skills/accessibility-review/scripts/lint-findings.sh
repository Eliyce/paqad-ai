#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Validate design-test skill output. Each finding must include a
         contract_ref to docs/instructions/design-system/* and an
         Evidence: file:line citation.
Usage:   bash scripts/lint-findings.sh <file>   (or stdin)
Exits:   0 clean | 1 issues found | 2 usage error
USAGE
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Findings' <<<"$body" || say 'missing "## Findings" heading'

findings=$(printf '%s\n' "$body" | awk '/^## Findings/{f=1;next} /^## /{f=0} f && /^- /')
[ -z "$findings" ] && say 'no finding bullets under "## Findings"'

while IFS= read -r line; do
  [ -z "$line" ] && continue
  grep -qE '\b(blocker|high|medium|low|nit)\b' <<<"$line" \
    || say "finding missing severity: $line"
  grep -qE '(tokens|components|accessibility|responsive|motion|patterns)\.md|WCAG-[0-9]+\.[0-9]+(\.[0-9]+)*' <<<"$line" \
    || say "finding missing contract_ref (e.g. tokens.md → token.name or WCAG-2.2.1.4.3): $line"
  grep -qE 'Evidence:.*[^[:space:]]+:[0-9]+' <<<"$line" \
    || say "finding missing 'Evidence: file:line': $line"
  grep -qE 'Required action:' <<<"$line" \
    || say "finding missing 'Required action:': $line"
done <<EOF
$findings
EOF

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
