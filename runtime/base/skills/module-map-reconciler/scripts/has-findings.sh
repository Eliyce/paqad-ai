#!/usr/bin/env bash
# Purpose: Read .paqad/module-map/drift.json and report whether any MM-*
#          findings are present.
# Usage:   bash scripts/has-findings.sh [project-root]
#          project-root defaults to the current directory.
# Output:  Number of findings on stdout.
# Exits:   0 findings present
#          1 clean (zero findings)
#          2 reconciler blocked (e.g. source_roots_unknown)
#          3 drift.json missing — reconcile not run yet
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-$PWD}"
path="$root/.paqad/module-map/drift.json"
[ -f "$path" ] || { printf 'drift.json missing — run `paqad-ai module-map reconcile`\n' >&2; exit 3; }

out=$(node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const n = Array.isArray(j.findings) ? j.findings.length : 0;
const b = j.blocked || "none";
process.stdout.write(n + " " + b);
' "$path")
count="${out%% *}"
blocked="${out##* }"

printf '%s\n' "$count"
if [ "$blocked" != "none" ]; then printf 'blocked: %s\n' "$blocked" >&2; exit 2; fi
[ "$count" -gt 0 ] && exit 0 || exit 1
