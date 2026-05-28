#!/usr/bin/env bash
# Purpose: Diff the AST-derived component inventory against the declared
#          components.md inventory. Emits the gaps in both directions —
#          the LLM picks severities and writes findings; this script just
#          enumerates set differences deterministically.
#
# Usage:   bash scripts/diff-inventories.sh --source <inventory.tsv> --declared <components.tsv>
#
#          --source     TSV from derive-inventory.sh   (<name>\t<file>)
#          --declared   TSV from parse-components-md.sh (<name>\t<variants>\t<states>)
#
# Output:  one TSV row per gap to stdout:
#            <gap-category>\t<component-name>\t<details>
#          Gap categories:
#            in-source-not-declared    component exists in src/ but not in components.md
#            declared-not-in-source    components.md mentions a component the src tree doesn't have
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

source_tsv=""
declared_tsv=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source_tsv="$2"; shift 2 ;;
    --declared) declared_tsv="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$source_tsv" ]   || { printf 'error: --source <file> is required\n' >&2; exit 2; }
[ -n "$declared_tsv" ] || { printf 'error: --declared <file> is required\n' >&2; exit 2; }
[ -f "$source_tsv" ]   || { printf 'error: source file not found: %s\n' "$source_tsv" >&2; exit 2; }
[ -f "$declared_tsv" ] || { printf 'error: declared file not found: %s\n' "$declared_tsv" >&2; exit 2; }

# Extract names from both sides.
src_names=$(awk -F'\t' 'NF>=1 && $1!=""{print $1}' "$source_tsv" | sort -u)
dec_names=$(awk -F'\t' 'NF>=1 && $1!=""{print $1}' "$declared_tsv" | sort -u)

# Source minus declared = "in-source-not-declared".
comm -23 <(printf '%s\n' "$src_names") <(printf '%s\n' "$dec_names") \
  | while IFS= read -r name; do
      [ -z "$name" ] && continue
      file=$(awk -F'\t' -v n="$name" '$1==n{print $2; exit}' "$source_tsv")
      printf 'in-source-not-declared\t%s\t%s\n' "$name" "$file"
    done

# Declared minus source = "declared-not-in-source".
comm -13 <(printf '%s\n' "$src_names") <(printf '%s\n' "$dec_names") \
  | while IFS= read -r name; do
      [ -z "$name" ] && continue
      printf 'declared-not-in-source\t%s\t-\n' "$name"
    done
