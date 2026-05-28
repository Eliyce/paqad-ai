#!/usr/bin/env bash
# Purpose: Emit one file path per line for every entry in the rollup
#          report's `unattributed_files` list. These are the MM-ADD
#          candidates the rollup hands off to the module-map reconciler.
# Usage:   bash scripts/list-unattributed.sh <report.json>   (or stdin)
# Output:  Sorted file paths on stdout; empty when nothing is unattributed.
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
    const files = (j.unattributed_files || []).slice().sort();
    process.stdout.write(files.join("\n") + (files.length ? "\n" : ""));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});'
