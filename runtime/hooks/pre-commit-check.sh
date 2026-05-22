#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

# Parse all exit codes in a single node invocation
RESULT=$(printf '%s' "$INPUT" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d||'{}');
  const t=Number(j.test_exit_code ?? 0);
  const l=Number(j.lint_exit_code ?? 0);
  const tc=Number(j.typecheck_exit_code ?? 0);
  const failures=[];
  if(t!==0) failures.push('tests');
  if(l!==0) failures.push('lint');
  if(tc!==0) failures.push('typecheck');
  process.stdout.write(JSON.stringify({ok:failures.length===0,failures}));
});
")

OK=$(printf '%s' "$RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(String(JSON.parse(d).ok))})")

if [[ "$OK" != "true" ]]; then
  FAILURES=$(printf '%s' "$RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(JSON.parse(d).failures.join(', '))})")
  echo "{\"message\":\"Pre-commit check failed: ${FAILURES}\"}" >&2
  exit 2
fi

exit 0
