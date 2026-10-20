#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Normalize a color literal to canonical lowercase 6-digit hex so
         the LLM can match leaked colors against declared tokens by string
         equality instead of fuzzy comparison.

Usage:   bash scripts/normalize-color.sh <color>     (or read stdin)

Output:  canonical hex (e.g. #1a73e8) to stdout — single line, no trailing
         space. Diagnostics to stderr.

Accepts:
  - #RGB / #RRGGBB / #RRGGBBAA  (alpha stripped if = ff)
  - rgb(r, g, b) / rgba(r, g, b, a)  (alpha ignored)
  - simple named CSS colors are NOT resolved here — those are leaks by
    definition and the LLM treats them as gaps in the contract.

Exits:   0 normalized   | 1 unrecognized format
USAGE
  exit 0
fi

if [ "${1:-}" = "" ] || [ "${1:-}" = "-" ]; then
  raw=$(cat)
else
  raw="$1"
fi

raw=$(printf '%s' "$raw" | awk '{$1=$1; print}')

lower=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')

normalize_hex() {
  local h="${1#'#'}"
  case "${#h}" in
    3)
      printf '#%s%s%s%s%s%s\n' "${h:0:1}" "${h:0:1}" "${h:1:1}" "${h:1:1}" "${h:2:1}" "${h:2:1}"
      return 0 ;;
    6)
      printf '#%s\n' "$h"
      return 0 ;;
    8)
      if [ "${h:6:2}" = "ff" ]; then
        printf '#%s\n' "${h:0:6}"
      else
        printf '#%s\n' "$h"
      fi
      return 0 ;;
    *) return 1 ;;
  esac
}

if [[ "$lower" =~ ^#[0-9a-f]{3}$ ]] || [[ "$lower" =~ ^#[0-9a-f]{6}$ ]] || [[ "$lower" =~ ^#[0-9a-f]{8}$ ]]; then
  normalize_hex "$lower"
  exit 0
fi

if [[ "$lower" =~ ^rgba?\(([[:space:]]*[0-9]+[[:space:]]*,[[:space:]]*[0-9]+[[:space:]]*,[[:space:]]*[0-9]+) ]]; then
  triple="${BASH_REMATCH[1]}"
  IFS=',' read -r r g b <<<"$(printf '%s' "$triple" | tr -d ' ')"
  for v in "$r" "$g" "$b"; do
    if [ "$v" -lt 0 ] || [ "$v" -gt 255 ]; then
      printf 'error: rgb component out of range: %s\n' "$lower" >&2
      exit 1
    fi
  done
  printf '#%02x%02x%02x\n' "$r" "$g" "$b"
  exit 0
fi

printf 'error: unrecognized color format: %s\n' "$raw" >&2
exit 1
