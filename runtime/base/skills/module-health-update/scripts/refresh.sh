#!/usr/bin/env bash
# Purpose: Update every module's health in one pass: test-driven rollup first
#          (coverage / tests / change_velocity from the active pack's reports),
#          then session-evidence sync (defect frequency / contract stability /
#          verification status). Writes .paqad/module-health/<slug>.json.
# Usage:   bash scripts/refresh.sh [project-root]
#          project-root defaults to the current directory.
# Output:  One combined JSON object on stdout: {"rollup": <report|null>,
#          "sync": <result|null>}. Either side is null when its command
#          produced no parseable JSON (e.g. paqad-ai not on PATH). Feed it to
#          the is-blocked / list-* helpers in this directory.
# Exits:   Always 0. A blocked rollup (e.g. module_health_unknown, when the pack
#          declares no module_health block) is informational, not fatal — the
#          sync pass still runs and the workflow reports what it could compute.
set +e

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

project_root="${1:-$PWD}"

rollup_json=$(paqad-ai module-health rollup --project-root "$project_root" 2>/dev/null)
sync_json=$(paqad-ai module-health sync --project-root "$project_root" 2>/dev/null)

ROLLUP="$rollup_json" SYNC="$sync_json" node -e '
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
process.stdout.write(
  JSON.stringify(
    { rollup: parse(process.env.ROLLUP || ""), sync: parse(process.env.SYNC || "") },
    null,
    2,
  ) + "\n",
);
'

exit 0
