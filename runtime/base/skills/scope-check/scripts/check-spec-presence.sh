#!/usr/bin/env bash
# Purpose: Fail-closed check that at least one active spec artifact exists.
# Usage:   bash scripts/check-spec-presence.sh [.paqad/specs]
# Output:  Sorted list of spec paths on stdout.
# Exits:   0 ≥1 spec found | 1 no specs (blocked-no-spec) | 2 usage error
set -euo pipefail
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
root="${1:-.paqad/specs}"
if [ ! -d "$root" ]; then
  printf 'no specs directory at %s — blocked-no-spec\n' "$root" >&2
  exit 1
fi
specs=$(find "$root" -maxdepth 2 -type f -name '*.md' 2>/dev/null | sort -u)
if [ -z "$specs" ]; then
  printf 'no spec artifacts found under %s — blocked-no-spec\n' "$root" >&2
  exit 1
fi
printf '%s\n' "$specs"
