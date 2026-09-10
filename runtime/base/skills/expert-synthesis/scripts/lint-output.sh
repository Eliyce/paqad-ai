#!/usr/bin/env bash
# Purpose: Validate expert-synthesis output. Requires a known verdict and the
#          accepted/declined/conflicts/gaps arrays; declined rows carry a reason.
# Usage:   bash scripts/lint-output.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

printf '%s' "$body" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const problems = [];
  let doc;
  try { doc = JSON.parse(raw); } catch { console.error("output is not valid JSON"); process.exit(1); }
  const VERDICTS = ["ready", "needs-answers", "not-ready"];
  if (!doc || typeof doc !== "object") { console.error("output must be an object"); process.exit(1); }
  if (!VERDICTS.includes(doc.verdict)) problems.push(`verdict must be one of ${VERDICTS.join(" | ")}`);
  for (const key of ["accepted", "declined", "conflicts", "gaps"]) {
    if (!Array.isArray(doc[key])) problems.push(`${key} must be an array`);
  }
  if (Array.isArray(doc.declined)) {
    doc.declined.forEach((d, i) => {
      if (!d || typeof d.id !== "string") problems.push(`declined[${i}] needs an id`);
      if (!d || typeof d.reason !== "string" || d.reason.trim() === "") problems.push(`declined[${i}] needs a reason`);
    });
  }
  if (Array.isArray(doc.conflicts)) {
    doc.conflicts.forEach((c, i) => {
      if (!c || typeof c.target !== "string") problems.push(`conflicts[${i}] needs a target`);
      if (!c || typeof c.recommendation !== "string") problems.push(`conflicts[${i}] needs a recommendation`);
    });
  }
  if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
  console.log("ok");
});
'
