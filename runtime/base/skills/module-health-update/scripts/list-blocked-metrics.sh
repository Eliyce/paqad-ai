#!/usr/bin/env bash
# Purpose: Emit one `<slug>: <reason1>, <reason2>, ...` line per module with a
#          non-empty `blocked_metrics` list in the rollup pass of a combined
#          refresh report. These are the informational warnings the update
#          workflow surfaces (config gaps, not Decision Pause packets).
# Usage:   bash scripts/list-blocked-metrics.sh <report.json>   (or stdin)
# Output:  Lines on stdout, sorted by slug; empty when nothing is blocked.
# Exits:   0 ok | 2 usage / parse error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
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
    const modules = (j.rollup && j.rollup.modules) || [];
    const lines = modules
      .map(m => ({ slug: m.slug, reasons: (m.profile && m.profile.blocked_metrics) || [] }))
      .filter(m => m.reasons.length > 0)
      .sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
      .map(m => m.slug + ": " + m.reasons.join(", "));
    process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""));
  } catch (e) { process.stderr.write("parse error: " + e.message + "\n"); process.exit(2); }
});'
