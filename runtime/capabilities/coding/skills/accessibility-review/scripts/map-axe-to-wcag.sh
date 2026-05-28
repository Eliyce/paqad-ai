#!/usr/bin/env bash
# Purpose: Map an axe-core rule id to its primary WCAG 2.2 success criterion id
#          using the lookup in references/wcag-mapping.md. Deterministic table
#          lookup so the LLM doesn't re-derive it per finding.
#
# Usage:   bash scripts/map-axe-to-wcag.sh <axe-rule-id>      (or read stdin)
#
# Output:  the WCAG id to stdout (e.g. WCAG-2.2-1.4.3).
#          When the rule is not in the table, emits `WCAG-UNKNOWN` and a
#          diagnostic to stderr — the LLM then maps it manually.
#
# Exits:   0 ok (incl. unknown)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  rule=$(cat)
else
  rule="$1"
fi
rule=$(printf '%s' "$rule" | tr -d '[:space:]')

case "$rule" in
  color-contrast)         printf 'WCAG-2.2-1.4.3\n' ;;
  image-alt)              printf 'WCAG-2.2-1.1.1\n' ;;
  button-name)            printf 'WCAG-2.2-4.1.2\n' ;;
  link-name)              printf 'WCAG-2.2-2.4.4\n' ;;
  label)                  printf 'WCAG-2.2-1.3.1\n' ;;
  landmark-one-main)      printf 'WCAG-2.2-1.3.1\n' ;;
  focus-order-semantics)  printf 'WCAG-2.2-2.4.3\n' ;;
  tabindex)               printf 'WCAG-2.2-2.4.3\n' ;;
  target-size)            printf 'WCAG-2.2-2.5.8\n' ;;
  html-has-lang)          printf 'WCAG-2.2-3.1.1\n' ;;
  "")
    printf 'error: axe rule id is required\n' >&2
    exit 2
    ;;
  *)
    printf 'note: axe rule %s not in mapping table\n' "$rule" >&2
    printf 'WCAG-UNKNOWN\n'
    ;;
esac
