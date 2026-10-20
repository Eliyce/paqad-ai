#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Select stories from a story plan that need a rollback procedure.
         Criteria: reversibility: hard OR blast-radius: wide OR workflow=migration.
Usage:   bash scripts/select-stories.sh <story-plan-file> [workflow]
Output:  story-id per line, sorted unique.
USAGE
  exit 0
fi
plan="${1:-}"
workflow="${2:-}"
[ -f "$plan" ] || { printf 'error: story plan not found: %s\n' "$plan" >&2; exit 1; }

node -e '
const fs = require("fs");
const txt = fs.readFileSync(process.argv[1], "utf8");
const workflow = process.argv[2] || "";
const blocks = txt.split(/\n(?=### S-\d+\b|^S-\d+:)/m);
const out = new Set();
for (const b of blocks) {
  const id = (b.match(/\bS-\d+\b/) || [])[0];
  if (!id) continue;
  const hard = /reversibility:\s*hard/i.test(b);
  const wide = /blast[-\s]?radius:\s*wide/i.test(b);
  if (hard || wide || workflow === "migration") out.add(id);
}
[...out].sort().forEach(s => console.log(s));
' "$plan" "$workflow"
