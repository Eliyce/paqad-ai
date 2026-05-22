#!/usr/bin/env bash
# Synchronize module health evidence after provider activity. Always exits 0.
set +e
trap 'exit 0' ERR EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if command -v paqad-ai >/dev/null 2>&1; then
  paqad-ai module-health sync --project-root "$PROJECT_ROOT" --provider "${PAQAD_PROVIDER:-provider-hook}" --silent >/dev/null 2>&1
elif [ -f "$PROJECT_ROOT/dist/cli/index.js" ] && command -v node >/dev/null 2>&1; then
  node "$PROJECT_ROOT/dist/cli/index.js" module-health sync --project-root "$PROJECT_ROOT" --provider "${PAQAD_PROVIDER:-provider-hook}" --silent >/dev/null 2>&1
fi

exit 0
