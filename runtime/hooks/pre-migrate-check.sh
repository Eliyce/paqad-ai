#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
REVIEW_OK=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d||'{}');process.stdout.write(String(Boolean(j.db_review_passed)))})")

if [[ "$REVIEW_OK" != "true" ]]; then
  echo '{"message":"Migration blocked: DB review must pass first"}' >&2
  exit 2
fi

exit 0
