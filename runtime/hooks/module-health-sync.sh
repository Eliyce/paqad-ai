#!/usr/bin/env bash
set +e
trap 'exit 0' ERR EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVIDER="${PAQAD_PROVIDER:-provider-hook}"

run_paqad() {
  local cmd="$1"
  shift
  if command -v paqad-ai >/dev/null 2>&1; then
    paqad-ai module-health "$cmd" --project-root "$PROJECT_ROOT" --silent "$@" >/dev/null 2>&1
  elif [ -f "$PROJECT_ROOT/dist/cli/index.js" ] && command -v node >/dev/null 2>&1; then
    node "$PROJECT_ROOT/dist/cli/index.js" module-health "$cmd" \
      --project-root "$PROJECT_ROOT" --silent "$@" >/dev/null 2>&1
  fi
}

run_paqad rollup
run_paqad sync --provider "$PROVIDER"

exit 0
