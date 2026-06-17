#!/usr/bin/env bash
# Purpose: Read a combined refresh report (JSON, from `refresh.sh` stdout or a
#          file) and report whether the rollup pass was blocked (e.g.
#          `module_health_unknown`). The sync pass runs regardless, so a blocked
#          rollup is informational — not a hard stop for the update workflow.
# Usage:   bash scripts/is-blocked.sh <report.json>   (or stdin)
# Output:  Blocked reason on stdout (or `none`).
# Exits:   0 not blocked | 1 blocked | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
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
    const rollup = j.rollup || {};
    process.stdout.write(rollup.blocked || "none");
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});')

printf '%s\n' "$reason"
[ "$reason" = "none" ] && exit 0 || exit 1
