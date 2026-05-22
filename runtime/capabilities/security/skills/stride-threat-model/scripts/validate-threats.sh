#!/usr/bin/env bash
# Purpose: Validate stride-threats.json: required fields, allowed STRIDE
#          category, severity_hint vocabulary, capped at 50 entries.
# Usage:   bash scripts/validate-threats.sh <file>   (or stdin)
# Exits:   0 clean | 1 issues | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0
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

const REQ = ["module","asset","stride_category","threat_description","severity_hint"];
const STRIDE = new Set(["spoofing","tampering","repudiation","information-disclosure","denial-of-service","elevation-of-privilege"]);
const SEV = new Set(["critical","high","medium","low"]);

let issues = 0;
if (arr.length > 50) { console.error("inventory too large: " + arr.length + " entries (cap 50)"); issues++; }
for (const [i, t] of arr.entries()) {
  for (const k of REQ) if (!(k in t)) { console.error("#" + i + ": missing " + k); issues++; }
  if (t.stride_category && !STRIDE.has(String(t.stride_category).toLowerCase())) {
    console.error("#" + i + ": bad stride_category " + t.stride_category); issues++;
  }
  if (t.severity_hint && !SEV.has(String(t.severity_hint).toLowerCase())) {
    console.error("#" + i + ": bad severity_hint " + t.severity_hint); issues++;
  }
  if (t.threat_description && /^(generic|boilerplate)/i.test(t.threat_description)) {
    console.error("#" + i + ": generic threat_description — name the specific asset/route"); issues++;
  }
}
if (issues) process.exit(1);
console.log("ok");
' "$body"
