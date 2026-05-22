#!/usr/bin/env bash
# Purpose: Digest .paqad/session/verification-evidence.json into a flat
#          one-failure-per-line anchor table the LLM can cite directly.
# Usage:   bash scripts/digest-evidence.sh [evidence-json]
#          Default path: .paqad/session/verification-evidence.json
# Output:  One line per failure: <gate> | <category> | <file>:<line> | <ac_id> | <message>
#          Header line first; "(no failures)" if evidence file is clean.
# Exits:   0 ok | 1 evidence missing/unreadable | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

evidence="${1:-.paqad/session/verification-evidence.json}"

if [ ! -f "$evidence" ]; then
  printf 'error: evidence file not found: %s\n' "$evidence" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const path = process.argv[1];
let data;
try { data = JSON.parse(fs.readFileSync(path, "utf8")); }
catch (e) { console.error("error: invalid JSON in " + path + ": " + e.message); process.exit(1); }

const rows = [];
const gates = Array.isArray(data.gates) ? data.gates : [];
for (const g of gates) {
  const fails = Array.isArray(g.failures) ? g.failures : [];
  for (const f of fails) {
    rows.push([
      g.name || "?",
      f.category || "?",
      (f.file || "?") + ":" + (f.line ?? "?"),
      f.ac_id || "-",
      (f.message || "").replace(/\s+/g, " ").slice(0, 240),
    ]);
  }
}
console.log("gate | category | file:line | ac_id | message");
if (rows.length === 0) { console.log("(no failures)"); process.exit(0); }
rows.sort((a,b) => a.join("|").localeCompare(b.join("|")));
for (const r of rows) console.log(r.join(" | "));
' "$evidence"
