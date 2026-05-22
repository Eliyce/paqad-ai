#!/usr/bin/env bash
# Purpose: Read the three canonical resume inputs and emit a compact bundle
#          (handoff body + JSON-extracted identity fields) to stdout.
# Usage:   bash scripts/load-resume-bundle.sh
# Output:  Multi-section text:
#            === handoff ===           (raw handoff.md)
#            === project ===           (slug, stack, domain, lanes, profile flags)
#            === manifest ===          (onboarding identity)
# Exits:   0 ok | 1 missing input | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0
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
# Pull out a few well-known YAML scalars without yq.
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
