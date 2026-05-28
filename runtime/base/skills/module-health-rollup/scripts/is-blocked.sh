#!/usr/bin/env bash
# Purpose: Read a rollup report (JSON, from `rollup.sh` stdout or a file)
#          and report whether the whole rollup is blocked (e.g.
#          `module_health_unknown`).
# Usage:   bash scripts/is-blocked.sh <report.json>   (or stdin)
# Output:  Blocked reason on stdout (or `none`).
# Exits:   0 not blocked | 1 blocked | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then body=$(cat)
elif [ -f "$1" ]; then body=$(cat "$1")
else printf 'error: file not found: %s\n' "$1" >&2; exit 2
fi

reason=$(printf '%s' "$body" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(j.blocked || "none");
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});')

printf '%s\n' "$reason"
[ "$reason" = "none" ] && exit 0 || exit 1
