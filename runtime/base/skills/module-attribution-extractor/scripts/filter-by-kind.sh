#!/usr/bin/env bash
# Purpose: Filter the extractor's `candidates` array by `kind`.
# Usage:   bash scripts/filter-by-kind.sh <kind> [report.json]
#          kind is one of: exact-match | near-collision | unknown
#          report.json defaults to stdin.
# Output:  JSON array of matching candidates on stdout.
# Exits:   0 ok (may be empty array) | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

kind="$1"
case "$kind" in
  exact-match|near-collision|unknown) ;;
  *) printf 'error: kind must be exact-match|near-collision|unknown (got %s)\n' "$kind" >&2; exit 2 ;;
esac

if [ "${2:-}" = "" ] || [ "${2:-}" = "-" ]; then body=$(cat)
elif [ -f "$2" ]; then body=$(cat "$2")
else printf 'error: file not found: %s\n' "$2" >&2; exit 2
fi

printf '%s' "$body" | KIND="$kind" node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    const out = Array.isArray(j.candidates) ? j.candidates.filter(c => c.kind === process.env.KIND) : [];
    process.stdout.write(JSON.stringify(out));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});'
