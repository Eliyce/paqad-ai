#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Stage 2 prerequisite check — ensure module-map.yml exists.
Usage:   bash scripts/check-stage2-prereq.sh
Output:  "ok" when present; otherwise the canonical refusal message on stderr.
USAGE
  exit 0
fi
map="docs/instructions/rules/module-map.yml"
if [ ! -f "$map" ]; then
  printf 'I cannot find %s. Prompt me with create documentation first, review the generated module map, then prompt me with create module documentation.\n' "$map" >&2
  exit 1
fi
printf 'ok\n'
