#!/usr/bin/env bash
# Purpose: Emit one module slug per line for every profile the sync pass updated
#          in a combined refresh report (`sync.updated_profiles`). These are the
#          modules whose health moved this run.
# Usage:   bash scripts/list-updated.sh <report.json>   (or stdin)
# Output:  Sorted slugs on stdout; empty when the sync pass updated nothing.
# Exits:   0 ok | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

printf '%s' "$body" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    const slugs = ((j.sync && j.sync.updated_profiles) || []).slice().sort();
    process.stdout.write(slugs.join("\n") + (slugs.length ? "\n" : ""));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});'
