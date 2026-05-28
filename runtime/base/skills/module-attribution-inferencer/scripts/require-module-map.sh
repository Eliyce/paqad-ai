#!/usr/bin/env bash
# Purpose: Stop-condition gate — refuse to run the inferencer when
#          module-map.yml is missing (the inferencer needs the map to
#          form hypotheses; see SKILL.md "Escalate / Stop Conditions").
# Usage:   bash scripts/require-module-map.sh [project-root]
#          project-root defaults to the current directory.
# Output:  Resolved path to module-map.yml on stdout when present.
# Exits:   0 map present
#          1 map missing (prints actionable message to stderr)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

project_root="${1:-$PWD}"
map_path="$project_root/docs/instructions/rules/module-map.yml"

if [ -f "$map_path" ]; then
  printf '%s\n' "$map_path"
  exit 0
fi

printf 'Inferencer requires module-map.yml; run "create documentation" first.\n' >&2
exit 1
