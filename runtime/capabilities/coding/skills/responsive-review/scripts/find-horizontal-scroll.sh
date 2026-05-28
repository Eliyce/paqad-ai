#!/usr/bin/env bash
# Purpose: From a runtime-checks.json (Step 3 of design-test), emit the
#          (route, breakpoint) pairs where horizontalScroll == true.
#
# Usage:   bash scripts/find-horizontal-scroll.sh <runtime-checks.json>
#
# Output:  one TSV row per offending pair to stdout:
#            <route>\t<breakpoint>\t<scroll-width>\t<viewport-width>
#          Diagnostics to stderr.
#
# Exits:   0 ok (incl. empty result)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
[ -n "$file" ] || { printf 'error: runtime-checks.json path is required\n' >&2; exit 2; }
[ -f "$file" ] || { printf 'error: file not found: %s\n' "$file" >&2; exit 2; }

node - "$file" <<'NODE'
const fs = require('node:fs');
const [, , path] = process.argv;
let data;
try { data = JSON.parse(fs.readFileSync(path, 'utf8')); }
catch (e) { console.error('error: invalid JSON: ' + e.message); process.exit(2); }
if (!data || !Array.isArray(data.routes)) {
  console.error('error: expected runtime-checks payload with .routes[]');
  process.exit(2);
}
for (const r of data.routes) {
  const route = r.path ?? '(unknown)';
  for (const bp of r.breakpoints ?? []) {
    if (bp && bp.horizontalScroll === true) {
      console.log([route, bp.name ?? '(unknown)', bp.scrollWidth ?? 0, bp.viewportWidth ?? 0].join('\t'));
    }
  }
}
NODE
