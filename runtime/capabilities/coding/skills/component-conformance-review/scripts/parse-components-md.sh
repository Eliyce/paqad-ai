#!/usr/bin/env bash
# Purpose: Parse the project's components.md contract clause into structured
#          TSV rows the LLM matches the AST inventory against.
#
# Usage:   bash scripts/parse-components-md.sh <components.md>
#
# Output:  one TSV row per declared component to stdout:
#            <name>\t<variants-csv>\t<states-csv>
#          Empty CSV slots are represented as `-` so consumers can tell
#          "declared empty" from "missing".
#          Diagnostics to stderr.
#
# Expected components.md shape (the format documented in
# references/component-conformance-checklist.md):
#
#   ## Button
#
#   - variants: primary, secondary, ghost
#   - states: default, hover, focus, disabled
#
# Lines that don't fit are ignored with a stderr note.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
if [ -z "$file" ]; then
  printf 'error: components.md path is required\n' >&2
  exit 2
fi
if [ ! -f "$file" ]; then
  printf 'error: file not found: %s\n' "$file" >&2
  exit 2
fi

awk '
  function flush() {
    if (name != "") {
      v = (variants == "" ? "-" : variants)
      s = (states == "" ? "-" : states)
      printf "%s\t%s\t%s\n", name, v, s
    }
    name = ""; variants = ""; states = ""
  }
  # H2 heading marks a new component. Format: `## Name`.
  # `[A-Z]` is locale-dependent in awk; use an explicit byte set so a `## foo`
  # heading never accidentally registers as a component on POSIX runners.
  /^##[[:space:]]+[ABCDEFGHIJKLMNOPQRSTUVWXYZ][A-Za-z0-9_-]*[[:space:]]*$/ {
    flush()
    name = $0
    sub(/^##[[:space:]]+/, "", name)
    sub(/[[:space:]]+$/, "", name)
    next
  }
  # bullet metadata: `- variants: a, b, c` or `- states: a, b, c`
  /^[[:space:]]*[-*][[:space:]]+(variants|states):[[:space:]]*/ {
    line = $0
    sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
    colon = index(line, ":")
    key = substr(line, 1, colon - 1)
    val = substr(line, colon + 1)
    gsub(/^[[:space:]]+/, "", val); gsub(/[[:space:]]+$/, "", val)
    gsub(/,[[:space:]]+/, ",", val)
    gsub(/[[:space:]]+,/, ",", val)
    if (key == "variants") variants = val
    else if (key == "states") states = val
    next
  }
  END { flush() }
' "$file"
