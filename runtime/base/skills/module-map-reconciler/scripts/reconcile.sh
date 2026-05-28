#!/usr/bin/env bash
# Purpose: Reconcile module-map.yml against the source tree.
#          Writes .paqad/module-map/drift.json with any MM-* findings.
# Usage:   bash scripts/reconcile.sh [project-root]
#          project-root defaults to the current directory.
# Output:  JSON drift report on stdout.
# Exits:   0 no findings | non-zero on drift or blocked reconciler
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

project_root="${1:-$PWD}"

exec paqad-ai module-map reconcile --project-root "$project_root"
