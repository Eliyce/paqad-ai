#!/usr/bin/env bash
# Module-health sync hook. Issue #80, Phase 3 (spec AC #26): repurposed from
# evidence-only sync into rollup + sync. Always exits 0.
#
# Order matters: rollup first (test-driven metrics from coverage / test
# reports), sync second (session evidence pipeline). The two paths write to
# different fields of the same profile and don't conflict — rollup populates
# coverage_pct / tests_* / change_velocity with `evidence.rollup`, sync
# folds in defect frequency / verification status with the existing
# `evidence.processed_event_ids` audit trail.
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
