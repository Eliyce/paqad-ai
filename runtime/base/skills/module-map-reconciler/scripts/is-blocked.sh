#!/usr/bin/env bash
# Purpose: Stop-condition gate — exit non-zero when the reconciler is
#          blocked (typically source_roots_unknown).
# Usage:   bash scripts/is-blocked.sh [project-root]
#          project-root defaults to the current directory.
# Output:  Blocked reason on stdout (or `none`).
# Exits:   0 not blocked | 1 blocked | 2 drift.json missing
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-$PWD}"
path="$root/.paqad/module-map/drift.json"
[ -f "$path" ] || { printf 'drift.json missing — run `paqad-ai module-map reconcile`\n' >&2; exit 2; }

reason=$(node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(j.blocked || "none");
' "$path")

printf '%s\n' "$reason"
[ "$reason" = "none" ] && exit 0 || exit 1
