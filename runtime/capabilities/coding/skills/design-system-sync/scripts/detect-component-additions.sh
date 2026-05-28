#!/usr/bin/env bash
# Purpose: Detect added component files in a unified diff. New component files
#          are signaled by `diff --git a/... b/<path>` plus a `new file mode`
#          line followed by `--- /dev/null`. Each addition triggers a proposal
#          to extend components.md.
#
# Usage:   bash scripts/detect-component-additions.sh                  (reads stdin)
#          bash scripts/detect-component-additions.sh <file>           (reads file)
#
# Output:  one row per added component file to stdout:
#            <component-name>\t<source-file>
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  body=$(cat)
elif [ -f "$1" ]; then
  body=$(cat "$1")
else
  printf 'error: file not found: %s\n' "$1" >&2
  exit 2
fi

# State machine: a `new file mode` line sets a flag; the next `+++ b/<path>`
# line emits the component if the path is under src/components/ and the
# filename starts with an uppercase letter.
printf '%s\n' "$body" | awk '
  /^new file mode/ { is_new = 1; next }
  /^\+\+\+ b\// && is_new {
    path = substr($0, 7)            # strip `+++ b/`
    is_new = 0
    if (path !~ /src\/components\//) next
    # ignore test/spec/stories/d.ts/index files
    if (path ~ /\.test\./ || path ~ /\.spec\./ || path ~ /\.stories\./) next
    if (path ~ /\.d\.ts$/) next
    n = split(path, parts, "/")
    base = parts[n]
    if (base == "index.ts" || base == "index.tsx" || base == "index.js" || base == "index.jsx") next
    name = base
    sub(/\.[^.]+$/, "", name)
    first = substr(name, 1, 1)
    if (first ~ /[A-Z]/) {
      printf "%s\t%s\n", name, path
    }
  }
  /^diff --git/ { is_new = 0 }
'
