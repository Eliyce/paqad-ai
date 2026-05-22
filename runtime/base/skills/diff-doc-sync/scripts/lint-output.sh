#!/usr/bin/env bash
# Purpose: Validate that the skill output is a stable, sorted, duplicate-free
#          JSON array of canonical doc paths.
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
let arr;
try { arr = JSON.parse(txt); } catch (e) {
  console.error("not valid JSON: " + e.message); process.exit(1);
}
if (!Array.isArray(arr)) { console.error("not a JSON array"); process.exit(1); }
const sorted = [...arr].sort();
if (JSON.stringify(arr) !== JSON.stringify(sorted)) {
  console.error("array is not sorted"); process.exit(1);
}
if (new Set(arr).size !== arr.length) {
  console.error("array has duplicates"); process.exit(1);
}
for (const p of arr) {
  if (typeof p !== "string" || !p.endsWith(".md")) {
    console.error("non-string or non-.md entry: " + p); process.exit(1);
  }
}
console.log("ok");
' "$body"
