#!/usr/bin/env bash
# Purpose: Given a leaked literal value and a parsed tokens TSV (as emitted
#          by parse-tokens.sh), suggest the matching declared token — purely
#          deterministic, no LLM guessing.
#
# Usage:   bash scripts/match-leak-to-token.sh --leak <value> --tokens <tsv-file>
#                                              [--namespace <ns>]
#
#          --leak       the literal value found in source (hex, rgb, or token value)
#          --tokens     path to a TSV produced by parse-tokens.sh (name<TAB>value<TAB>namespace)
#          --namespace  optional filter: only consider tokens in this namespace
#                       (e.g. color, spacing, radius)
#
# Output:  to stdout:
#            match\t<token-name>     when exactly one token has the same value
#            ambiguous\t<n1>,<n2>... when multiple tokens have the same value
#            no-match                when no token matches
#          diagnostics to stderr.
#
# For colors, the comparison normalizes both the leak and each token value
# using normalize-color.sh so `#1A73E8`, `#1a73e8`, `rgb(26, 115, 232)` all
# resolve to the same canonical form.
#
# Exits:   0 ok (regardless of match/ambiguous/no-match)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

leak=""
tokens=""
ns=""
while [ $# -gt 0 ]; do
  case "$1" in
    --leak) leak="$2"; shift 2 ;;
    --tokens) tokens="$2"; shift 2 ;;
    --namespace) ns="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$leak" ] || { printf 'error: --leak <value> is required\n' >&2; exit 2; }
[ -n "$tokens" ] || { printf 'error: --tokens <tsv-file> is required\n' >&2; exit 2; }
[ -f "$tokens" ] || { printf 'error: tokens file not found: %s\n' "$tokens" >&2; exit 2; }

here="$(cd "$(dirname "$0")" && pwd)"
normalize="$here/normalize-color.sh"

# Try to normalize the leak as a color. If it normalizes, compare normalized
# values; otherwise compare raw (case-insensitive) strings.
leak_norm=""
if leak_norm=$(bash "$normalize" "$leak" 2>/dev/null); then : ; fi

matches=""
while IFS=$'\t' read -r name value token_ns || [ -n "${name:-}" ]; do
  [ -z "${name:-}" ] && continue
  # Optional namespace filter.
  if [ -n "$ns" ] && [ "$token_ns" != "$ns" ]; then
    continue
  fi
  cmp_value="$value"
  cmp_leak="$leak"
  if [ -n "$leak_norm" ]; then
    if token_norm=$(bash "$normalize" "$value" 2>/dev/null); then
      cmp_value="$token_norm"
      cmp_leak="$leak_norm"
    fi
  fi
  # Case-insensitive equality.
  if [ "$(printf '%s' "$cmp_value" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$cmp_leak" | tr '[:upper:]' '[:lower:]')" ]; then
    matches="${matches}${name},"
  fi
done < "$tokens"

matches="${matches%,}"
if [ -z "$matches" ]; then
  printf 'no-match\n'
elif [[ "$matches" == *","* ]]; then
  printf 'ambiguous\t%s\n' "$matches"
else
  printf 'match\t%s\n' "$matches"
fi
