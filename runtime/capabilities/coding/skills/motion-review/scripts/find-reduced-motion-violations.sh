#!/usr/bin/env bash
# Purpose: Find UI files that declare an animation/transition but DON'T guard
#          it for users with `prefers-reduced-motion: reduce`. Each match is
#          a high-severity finding candidate (a11y blocker).
#
# Usage:   bash scripts/find-reduced-motion-violations.sh [search-root]
#          Default search-root: src
#
# Output:  one TSV row per offending file to stdout:
#            <file>\t<animation-signal>
#          Where <animation-signal> is the first matched line (e.g.
#          `transition: all 300ms ease`).
#          Diagnostics to stderr.
#
# A file is considered safe (no row emitted) when EITHER:
#   - the file contains `prefers-reduced-motion`, OR
#   - the file contains `useReducedMotion(` (framer-motion hook).
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  exit 0
fi

# Files that declare any animation/transition surface.
animated=$(grep -rlE --binary-files=without-match \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
  --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' \
  -E '(transition|animation)(-duration)?[[:space:]]*:|@keyframes\b|<motion\.|useAnimation\(' \
  "$root" 2>/dev/null || true)

[ -z "$animated" ] && exit 0

while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -qE 'prefers-reduced-motion|useReducedMotion\(' "$f"; then
    continue
  fi
  # Extract the first animation-ish line for evidence.
  signal=$(grep -m1 -E '(transition|animation)(-duration)?[[:space:]]*:|@keyframes\b|<motion\.|useAnimation\(' "$f" || true)
  signal=$(printf '%s' "$signal" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')
  printf '%s\t%s\n' "$f" "${signal:0:140}"
done <<EOF
$animated
EOF
