#!/usr/bin/env bash
# Purpose: For a set of Playwright test files referring to a given component,
#          emit which states they exercise. Pairs with extract-source-states.sh —
#          the LLM cross-references the two outputs.
#
# Usage:   bash scripts/extract-tested-states.sh --component <Name> --tests <dir>
#
#          --component  the component name to look for (e.g. Button)
#          --tests      directory containing Playwright test files
#
# Output:  one TSV row per tested state to stdout:
#            <state>\t<test-file>
#          A state is "tested" when the component name appears in the same
#          file as the state driver (`.hover()`, `.focus()`, etc.) OR the
#          state keyword (loading/error/disabled/empty).
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

component=""
tests_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --component) component="$2"; shift 2 ;;
    --tests) tests_dir="$2"; shift 2 ;;
    *) printf 'error: unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$component" ] || { printf 'error: --component <Name> is required\n' >&2; exit 2; }
[ -n "$tests_dir" ] || { printf 'error: --tests <dir> is required\n' >&2; exit 2; }
if [ ! -d "$tests_dir" ]; then
  printf 'note: tests dir not found: %s\n' "$tests_dir" >&2
  exit 0
fi

# Files that mention this component. Portable across bash 3.2 (macOS default)
# and bash 4+: write the file list to a temp file and iterate via read.
files_list=$(mktemp)
trap 'rm -f "$files_list"' EXIT
grep -rlE "\\b${component}\\b" "$tests_dir" 2>/dev/null > "$files_list" || true
if [ ! -s "$files_list" ]; then
  exit 0
fi

check_state() {
  local state="$1"; local pattern="$2"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if grep -qE "$pattern" "$f"; then
      printf '%s\t%s\n' "$state" "$f"
    fi
  done < "$files_list"
}

# Every file mentioning the component implicitly exercises the default state.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  printf 'default\t%s\n' "$f"
done < "$files_list"

check_state hover    '\.hover\(\)|hover via|mouseover'
check_state focus    '\.focus\(\)|press\([^)]*Tab|keyboard\.press\([^)]*Tab|:focus-visible'
check_state disabled '\bdisabled\b|toBeDisabled|aria-disabled'
check_state loading  '\bloading\b|isLoading|spinner|Skeleton'
check_state error    '\berror\b|toHaveAttribute\([^)]*aria-invalid|toBeInvalid'
check_state empty    '\bempty\b|isEmpty|noResults|EmptyState'
