#!/usr/bin/env bash
# Purpose: Read an inferencer JSON report and gate on the `confident` flag.
# Usage:   bash scripts/is-confident.sh <report.json>   (or stdin)
# Output:  `true` or `false` on stdout.
# Exits:   0 confident | 1 not confident | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

value=$(printf '%s' "$body" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(String(j.confident === true));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});')

printf '%s\n' "$value"
[ "$value" = "true" ] && exit 0 || exit 1
