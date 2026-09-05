#!/usr/bin/env bash
# Purpose: Validate requirement-enrichment output: a JSON question batch
#          { "questions": [ { business_text, why_it_matters, options[], grounded_in, technical_note? } ] }.
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

node -e '
const txt = process.argv[1];
let doc;
try { doc = JSON.parse(txt); } catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
  console.error("expected a JSON object with a questions[] array"); process.exit(1);
}
if (!Array.isArray(doc.questions)) { console.error("missing questions[] array"); process.exit(1); }

const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
let issues = 0;
for (const [i, q] of doc.questions.entries()) {
  if (typeof q !== "object" || q === null || Array.isArray(q)) { console.error(`#${i}: not an object`); issues++; continue; }
  if (!nonEmptyString(q.business_text)) { console.error(`#${i}: business_text must be a non-empty string`); issues++; }
  if (!nonEmptyString(q.why_it_matters)) { console.error(`#${i}: why_it_matters must be a non-empty string`); issues++; }
  if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(nonEmptyString)) {
    console.error(`#${i}: options must be an array of >=2 non-empty strings`); issues++;
  }
  if (!("grounded_in" in q) || !(q.grounded_in === null || nonEmptyString(q.grounded_in))) {
    console.error(`#${i}: grounded_in must be a ref string or null`); issues++;
  }
  if ("technical_note" in q && typeof q.technical_note !== "string") {
    console.error(`#${i}: technical_note, when present, must be a string`); issues++;
  }
}
if (issues) process.exit(1);
console.log("ok");
' "$body"
