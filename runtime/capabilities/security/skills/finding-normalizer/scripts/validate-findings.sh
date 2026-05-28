#!/usr/bin/env bash
# Purpose: Validate a JSON array of normalized findings against the schema:
#          required fields present, ids unique, severity allowed, effort allowed.
# Usage:   bash scripts/validate-findings.sh <file>   (or stdin)
# Exits:   0 ok | 1 invalid | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

node -e '
const txt = process.argv[1];
let arr;
try { arr = JSON.parse(txt); } catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
if (!Array.isArray(arr)) { console.error("expected JSON array"); process.exit(1); }

const REQ = ["id","title","severity","effort","impact_area","evidence","reproduction","status"];
const SEV = new Set(["critical","blocker","high","medium","low","nit","info"]);
const EFF = new Set(["trivial","small","medium","large"]);
const STA = new Set(["open","fixed","wont-fix","blocked","accepted","waived","retest-pass","retest-fail","still-open","needs-manual-verification"]);

const ids = new Set();
let issues = 0;
for (const [i, f] of arr.entries()) {
  for (const k of REQ) if (!(k in f)) { console.error(`#${i}: missing field ${k}`); issues++; }
  if (f.id) {
    if (ids.has(f.id)) { console.error(`#${i}: duplicate id ${f.id}`); issues++; }
    ids.add(f.id);
  }
  if (f.severity && !SEV.has(String(f.severity).toLowerCase())) { console.error(`#${i}: bad severity ${f.severity}`); issues++; }
  if (f.effort && !EFF.has(String(f.effort).toLowerCase())) { console.error(`#${i}: bad effort ${f.effort}`); issues++; }
  if (f.status && !STA.has(String(f.status).toLowerCase())) { console.error(`#${i}: bad status ${f.status}`); issues++; }
}
if (issues) process.exit(1);
console.log("ok");
' "$body"
