#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Validate api-doc-maintainer output: requires "## Updated API Docs"
         and "## Coverage Gaps" sections, with at least one backtick-quoted
         path under Updated API Docs.
Usage:   bash scripts/lint-output.sh <file>   (or stdin)
Output:  "ok" on stdout; issues on stderr.
USAGE
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

issues=0
say() { printf '%s\n' "$1" >&2; issues=$((issues+1)); }

grep -qE '^## Updated API Docs' <<<"$body" || say 'missing "## Updated API Docs" heading'
grep -qE '^## Coverage Gaps'    <<<"$body" || say 'missing "## Coverage Gaps" heading'

updated=$(printf '%s\n' "$body" | awk '/^## Updated API Docs/{f=1;next} /^## /{f=0} f')
grep -qE '`[^`]+\.md`' <<<"$updated" \
  || say '"## Updated API Docs" must list at least one backtick-quoted .md path'

[ "$issues" -gt 0 ] && exit 1
printf 'ok\n'
