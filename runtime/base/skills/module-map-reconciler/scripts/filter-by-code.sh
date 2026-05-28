#!/usr/bin/env bash
# Purpose: Filter drift.json `findings` by MM-* code.
# Usage:   bash scripts/filter-by-code.sh <MM-CODE> [project-root]
#          project-root defaults to the current directory.
# Output:  JSON array of matching findings on stdout.
# Exits:   0 ok (may be empty array) | 2 usage / drift.json missing
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

case "$1" in
  MM-ADD|MM-FEAT-ADD|MM-REMOVE|MM-RENAME|MM-FEAT-STALE|MM-DOC-ORPHAN|MM-DOC-MISSING|MM-MISMATCH) ;;
  *) printf 'error: unknown MM-* code: %s\n' "$1" >&2; exit 2 ;;
esac

code="$1"
root="${2:-$PWD}"
path="$root/.paqad/module-map/drift.json"
[ -f "$path" ] || { printf 'drift.json missing — run `paqad-ai module-map reconcile`\n' >&2; exit 2; }

CODE="$code" node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const out = (j.findings || []).filter(f => f.code === process.env.CODE);
process.stdout.write(JSON.stringify(out));
' "$path"
