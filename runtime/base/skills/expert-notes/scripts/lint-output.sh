#!/usr/bin/env bash
# Purpose: Validate expert-notes output. Requires notes[]; each note names a role
#          and findings[] of {target, claim}; kind/severity, when present, are known.
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

# The shape check is JSON, so it runs in node (available as a paqad dependency); all
# diagnostics go to stderr and the exit code is the verdict.
printf '%s' "$body" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const problems = [];
  let doc;
  try { doc = JSON.parse(raw); } catch { console.error("output is not valid JSON"); process.exit(1); }
  const KINDS = ["requirement", "invariant", "acceptance", "risk", "non-goal"];
  const SEV = ["must", "should", "could"];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.notes)) {
    console.error("output needs a notes[] array");
    process.exit(1);
  }
  doc.notes.forEach((note, i) => {
    if (!note || typeof note.role !== "string") problems.push(`notes[${i}] needs a role`);
    if (!Array.isArray(note.findings)) { problems.push(`notes[${i}] needs findings[]`); return; }
    note.findings.forEach((f, j) => {
      if (!f || typeof f.target !== "string" || f.target.trim() === "") problems.push(`notes[${i}].findings[${j}] needs a target`);
      if (!f || typeof f.claim !== "string" || f.claim.trim() === "") problems.push(`notes[${i}].findings[${j}] needs a claim`);
      if (f && f.kind !== undefined && !KINDS.includes(f.kind)) problems.push(`notes[${i}].findings[${j}] unknown kind "${f.kind}"`);
      if (f && f.severity !== undefined && !SEV.includes(f.severity)) problems.push(`notes[${i}].findings[${j}] unknown severity "${f.severity}"`);
    });
    if (note.questions !== undefined && !Array.isArray(note.questions)) problems.push(`notes[${i}].questions must be an array`);
  });
  if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
  console.log("ok");
});
'
