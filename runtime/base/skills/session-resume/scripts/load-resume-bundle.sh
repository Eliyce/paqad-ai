#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Read the three canonical resume inputs and emit a compact bundle
         (handoff body + JSON-extracted identity fields) to stdout.
Usage:   bash scripts/load-resume-bundle.sh
Output:  Multi-section text:
           === handoff ===           (raw handoff.md)
           === project ===           (slug, stack, domain, lanes, profile flags)
           === manifest ===          (onboarding identity)
USAGE
  exit 0
fi

handoff=".paqad/session/handoff.md"
manifest=".paqad/onboarding-manifest.json"
profile=".paqad/project-profile.yaml"

missing=0
for f in "$handoff" "$manifest" "$profile"; do
  if [ ! -f "$f" ]; then printf 'missing: %s\n' "$f" >&2; missing=1; fi
done
[ "$missing" -eq 1 ] && exit 1

printf '=== handoff ===\n'
cat "$handoff"
printf '\n=== project ===\n'
grep -E '^(slug|domain|primary_stack|stack|lane|strictness|feature_flags):' "$profile" || true
printf '\n=== manifest ===\n'
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const keep = ["projectSlug","projectName","domain","detectedStack","capabilities","versions"];
const out = {};
for (const k of keep) if (m[k] !== undefined) out[k] = m[k];
console.log(JSON.stringify(out, null, 2));
' "$manifest"
