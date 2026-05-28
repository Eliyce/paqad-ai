#!/usr/bin/env bash
# Purpose: Grep UI source for animation/transition declarations and emit each
#          declaration with its duration normalized to milliseconds. The LLM
#          then matches the duration against the motion.md budget.
#
# Usage:   bash scripts/scan-animations.sh [search-root]
#          Default search-root: src
#
# Output:  TSV rows to stdout:
#            <file>:<line>\t<duration-ms>\t<excerpt>
#          A duration of 0 means "duration not parsed from this line" — the
#          LLM treats that as needing a manual look rather than a finding.
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="${1:-src}"
if [ ! -d "$root" ]; then
  printf 'note: search root not found: %s\n' "$root" >&2
  exit 0
fi

# Find lines that look like a transition or animation declaration:
#   transition: ... 300ms ...
#   transition-duration: 0.4s;
#   animation: name 200ms linear;
#   framer-motion: transition={{ duration: 0.3 }}  (cap captures `duration:`)
candidates=$(grep -rEn --binary-files=without-match \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
  --exclude='*.test.*' --exclude='*.spec.*' --exclude='*.stories.*' \
  -E '(transition|animation)(-duration)?[[:space:]]*:|duration[[:space:]]*:[[:space:]]*[0-9]' \
  "$root" 2>/dev/null || true)

printf '%s' "$candidates" | awk -F: '
  NF >= 3 {
    excerpt=""; for (i=3; i<=NF; i++) excerpt = excerpt (i==3?"":":") $i
    gsub(/[ \t]+/, " ", excerpt)

    ms = 0
    # Look for `<N>ms` first, then `<N>s` (seconds, fractional allowed).
    if (match(excerpt, /[0-9]+(\.[0-9]+)?ms\b/) ||
        match(excerpt, /[0-9]+(\.[0-9]+)?ms[^A-Za-z]/) ||
        match(excerpt, /[0-9]+(\.[0-9]+)?ms$/)) {
      s = substr(excerpt, RSTART, RLENGTH)
      if (match(s, /[0-9]+(\.[0-9]+)?/)) {
        ms = substr(s, RSTART, RLENGTH) + 0
      }
    } else if (match(excerpt, /[0-9]+(\.[0-9]+)?s/)) {
      s = substr(excerpt, RSTART, RLENGTH)
      # Reject `[0-9]+s` if it is actually `ms` (already handled) — match() above
      # already excluded the `m` prefix because the regex `[0-9]+...s` would
      # accept `300ms` too. Guard against that explicitly.
      if (substr(excerpt, RSTART - 1, 1) != "m") {
        if (match(s, /[0-9]+(\.[0-9]+)?/)) {
          n = substr(s, RSTART, RLENGTH) + 0
          ms = int(n * 1000 + 0.5)
        }
      }
    } else if (match(excerpt, /duration[[:space:]]*:[[:space:]]*[0-9]+(\.[0-9]+)?/)) {
      # framer-motion duration is in seconds by convention; treat 0–10 as
      # seconds, anything larger as milliseconds.
      s = substr(excerpt, RSTART, RLENGTH)
      if (match(s, /[0-9]+(\.[0-9]+)?/)) {
        n = substr(s, RSTART, RLENGTH) + 0
        if (n <= 10) ms = int(n * 1000 + 0.5)
        else ms = int(n)
      }
    }

    printf "%s:%s\t%d\t%s\n", $1, $2, ms, substr(excerpt, 1, 140)
  }
'
