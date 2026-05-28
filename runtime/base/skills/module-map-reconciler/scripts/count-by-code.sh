#!/usr/bin/env bash
# Purpose: Emit one `MM-CODE: N` line per finding code in drift.json,
#          sorted by code (only codes with N>0 are printed).
# Usage:   bash scripts/count-by-code.sh [project-root]
#          project-root defaults to the current directory.
# Output:  `MM-ADD: 3`-style lines on stdout (zero codes omitted).
# Exits:   0 ok | 2 drift.json missing
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-$PWD}"
path="$root/.paqad/module-map/drift.json"
[ -f "$path" ] || { printf 'drift.json missing — run `paqad-ai module-map reconcile`\n' >&2; exit 2; }

node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const counts = j.counts || {};
const lines = Object.entries(counts)
  .filter(([, n]) => Number(n) > 0)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([k, n]) => k + ": " + n);
process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""));
' "$path"
