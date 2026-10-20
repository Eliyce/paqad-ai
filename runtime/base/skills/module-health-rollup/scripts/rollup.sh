#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Run the test-driven module-health rollup.
         Writes .paqad/module-health/<slug>.json per declared module.
Usage:   bash scripts/rollup.sh [project-root] [--from-report <path>]
         project-root defaults to the current directory.
         --from-report short-circuits the rollup with a prebuilt report.
Output:  Rollup summary JSON on stdout.
USAGE
  exit 0
fi

project_root="$PWD"
report=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from-report) report="${2:-}"; shift 2 ;;
    --from-report=*) report="${1#*=}"; shift ;;
    -*) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
    *) project_root="$1"; shift ;;
  esac
done

args=(module-health rollup --project-root "$project_root")
[ -n "$report" ] && args+=(--from-report "$report")

exec paqad-ai "${args[@]}"
