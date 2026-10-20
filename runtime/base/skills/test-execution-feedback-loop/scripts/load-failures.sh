#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Load failures from verification evidence (schema 1.0.x) into a flat
         one-failure-per-line JSON stream the LLM can iterate over.
Usage:   bash scripts/load-failures.sh [evidence-json]
         Default: .paqad/session/verification-evidence.json
USAGE
  exit 0
fi
ev="${1:-.paqad/session/verification-evidence.json}"
[ -f "$ev" ] || { printf 'error: evidence not found: %s\n' "$ev" >&2; exit 1; }

node -e '
const fs = require("fs");
let d;
try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }

const sv = d.schema_version || "";
if (!/^1\.0\./.test(sv)) {
  console.error("unsupported schema_version: " + sv); process.exit(1);
}

let idx = 0;
for (const g of (d.gates || [])) {
  if (g.status === "pass") continue;
  for (const f of (g.failures || [])) {
    idx++;
    process.stdout.write(JSON.stringify({
      idx,
      gate: g.name,
      category: f.category,
      file: f.file,
      line: f.line,
      ac_id: f.ac_id,
      test_id: f.test_id,
      suite: f.suite,
      message: (f.message || "").replace(/\s+/g, " ").slice(0, 240),
    }) + "\n");
  }
}
if (idx === 0) console.error("(no failures)");
' "$ev"
