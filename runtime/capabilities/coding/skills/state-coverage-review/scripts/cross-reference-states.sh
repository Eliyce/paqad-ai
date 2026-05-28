#!/usr/bin/env bash
# Purpose: Cross-reference declared states (from components.md), implemented
#          states (from extract-source-states.sh), and tested states (from
#          extract-tested-states.sh). Emit gap rows the LLM turns into findings.
#
# Usage:   bash scripts/cross-reference-states.sh \
#            --declared <state1,state2,...>   (CSV from parse-components-md.sh)
#            --implemented <states-tsv>       (output of extract-source-states.sh)
#            --tested <states-tsv>            (output of extract-tested-states.sh)
#
# Output:  one TSV row per gap to stdout:
#            <gap>\t<state>
#          Gap categories:
#            declared-not-implemented   state in components.md but not in src
#            implemented-not-tested     state in src but no Playwright test
#            tested-not-implemented     test drives a state the src doesn't expose
#                                       (documentation-drift candidate)
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

declared_csv=""
impl_tsv=""
tested_tsv=""
while [ $# -gt 0 ]; do
  case "$1" in
    --declared) declared_csv="$2"; shift 2 ;;
    --implemented) impl_tsv="$2"; shift 2 ;;
    --tested) tested_tsv="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$declared_csv" ] || { printf 'error: --declared <csv> is required\n' >&2; exit 2; }
[ -n "$impl_tsv" ]     || { printf 'error: --implemented <file> is required\n' >&2; exit 2; }
[ -n "$tested_tsv" ]   || { printf 'error: --tested <file> is required\n' >&2; exit 2; }
[ -f "$impl_tsv" ]     || { printf 'error: implemented file not found: %s\n' "$impl_tsv" >&2; exit 2; }
[ -f "$tested_tsv" ]   || { printf 'error: tested file not found: %s\n' "$tested_tsv" >&2; exit 2; }

declared=$(printf '%s\n' "$declared_csv" | tr ',' '\n' | tr -d ' ' | awk 'NF' | sort -u)
implemented=$(awk -F'\t' '{print $1}' "$impl_tsv" | awk 'NF' | sort -u)
tested=$(awk -F'\t' '{print $1}' "$tested_tsv" | awk 'NF' | sort -u)

# declared - implemented
comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$implemented") \
  | while IFS= read -r s; do [ -n "$s" ] && printf 'declared-not-implemented\t%s\n' "$s"; done

# implemented - tested
comm -23 <(printf '%s\n' "$implemented") <(printf '%s\n' "$tested") \
  | while IFS= read -r s; do [ -n "$s" ] && printf 'implemented-not-tested\t%s\n' "$s"; done

# tested - implemented
comm -23 <(printf '%s\n' "$tested") <(printf '%s\n' "$implemented") \
  | while IFS= read -r s; do [ -n "$s" ] && printf 'tested-not-implemented\t%s\n' "$s"; done
