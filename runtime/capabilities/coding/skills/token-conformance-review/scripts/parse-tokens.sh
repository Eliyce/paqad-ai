#!/usr/bin/env bash
# Purpose: Parse the project's tokens.md contract clause into structured TSV
#          rows so the LLM can match leaks against declared tokens without
#          re-parsing markdown on every finding.
#
# Usage:   bash scripts/parse-tokens.sh <tokens.md>
#
# Output:  one TSV row per declared token, to stdout:
#            <name>\t<value>\t<namespace>
#          `name` is the dotted token id (e.g. color.primary.500).
#          `namespace` is the first dotted segment (color, spacing, radius, ...).
#          diagnostics to stderr.
#
# Token line shape this parser recognises (the only format documented in
# references/contract-clauses.md):
#   - color.primary.500 = #1a73e8
#   - spacing.4 = 16px
#   `* ` bullet form is also accepted.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
if [ -z "$file" ]; then
  printf 'error: tokens.md path is required\n' >&2
  printf 'usage: bash scripts/parse-tokens.sh <tokens.md>\n' >&2
  exit 2
fi
if [ ! -f "$file" ]; then
  printf 'error: file not found: %s\n' "$file" >&2
  exit 2
fi

# Match lines like:  - color.primary.500 = #1a73e8
# Allow leading whitespace, `-` or `*` bullet, optional space, name, `=`, value.
awk '
  /^[[:space:]]*[-*][[:space:]]+[a-zA-Z][a-zA-Z0-9_.-]*[[:space:]]*=[[:space:]]*/ {
    line = $0
    sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
    eq = index(line, "=")
    if (eq == 0) next
    name = substr(line, 1, eq - 1)
    value = substr(line, eq + 1)
    gsub(/[[:space:]]+$/, "", name)
    gsub(/^[[:space:]]+/, "", value)
    gsub(/[[:space:]]+$/, "", value)
    if (name == "" || value == "") next
    ns = name
    sub(/\..*$/, "", ns)
    printf "%s\t%s\t%s\n", name, value, ns
  }
' "$file"
