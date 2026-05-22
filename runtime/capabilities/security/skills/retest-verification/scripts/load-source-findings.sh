#!/usr/bin/env bash
# Purpose: Load and validate source pentest sidecar findings (the canonical
#          schema produced by finding-normalizer).
# Usage:   bash scripts/load-source-findings.sh <sidecar.json>
# Output:  One JSON object per line: id, title, severity, status, evidence
# Exits:   0 ok | 1 missing/invalid | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
[ -f "${1:-}" ] || { printf 'usage: %s <sidecar.json>\n' "$0" >&2; exit 2; }

node -e '
const fs = require("fs");
let arr;
try { arr = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
if (!Array.isArray(arr)) { console.error("expected JSON array"); process.exit(1); }
const REQ = ["id", "title", "severity"];
let bad = 0;
for (const [i, f] of arr.entries()) {
  for (const k of REQ) if (!(k in f)) { console.error("#" + i + ": missing " + k); bad++; }
}
if (bad) process.exit(1);
for (const f of arr) {
  process.stdout.write(JSON.stringify({
    id: f.id, title: f.title, severity: f.severity,
    status: f.status || "open",
    evidence: f.evidence || "",
  }) + "\n");
}
' "$1"
