#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Reconcile module-map.yml against the source tree.
         Writes .paqad/module-map/drift.json with any MM-* findings.
Usage:   bash scripts/reconcile.sh [project-root]
         project-root defaults to the current directory.
Output:  JSON drift report on stdout.
USAGE
  exit 0
fi

project_root="${1:-$PWD}"

exec paqad-ai module-map reconcile --project-root "$project_root"
