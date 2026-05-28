#!/usr/bin/env bash
# Purpose: Cross-reference the AST-derived component inventory against the
#          Playwright tests that exercise components. Emits per-component
#          coverage rows.
# Usage:   bash runtime/scripts/design/coverage.sh [--components-dir <dir>] [--tests-dir <dir>] [--out <path>]
# Output:  JSON with { component, tested_states[], source_file, test_files[] }
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

components_dir="src/components"
tests_dir=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --components-dir) components_dir="$2"; shift 2 ;;
    --tests-dir) tests_dir="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$tests_dir" ]; then
  for cand in tests/e2e e2e tests/playwright tests; do
    if [ -d "$cand" ]; then tests_dir="$cand"; break; fi
  done
fi

[ -d "$components_dir" ] || { printf 'note: components dir not found: %s\n' "$components_dir" >&2; }

components=()
if [ -d "$components_dir" ]; then
  while IFS= read -r f; do
    base=$(basename "$f")
    name="${base%.*}"
    components+=("$name|$f")
  done < <(find "$components_dir" -type f \( -name '*.tsx' -o -name '*.jsx' \) ! -name '*.test.*' ! -name '*.stories.*' 2>/dev/null)
fi

emit() {
  printf '{\n'
  printf '  "components": [\n'
  first=1
  for entry in "${components[@]}"; do
    name="${entry%%|*}"
    src="${entry#*|}"
    test_files=()
    if [ -n "$tests_dir" ] && [ -d "$tests_dir" ]; then
      while IFS= read -r tf; do test_files+=("$tf"); done \
        < <(grep -rlE "\b$name\b" "$tests_dir" 2>/dev/null || true)
    fi
    tested_states=()
    for tf in "${test_files[@]}"; do
      for st in default hover focus disabled loading error empty; do
        if grep -qE "\b$st\b" "$tf" 2>/dev/null; then tested_states+=("$st"); fi
      done
    done
    # de-dupe tested_states
    if [ ${#tested_states[@]} -gt 0 ]; then
      uniq_states=$(printf '%s\n' "${tested_states[@]}" | sort -u | paste -sd, -)
    else
      uniq_states=""
    fi
    if [ "$first" -eq 1 ]; then first=0; else printf ',\n'; fi
    printf '    { "component": "%s", "source_file": "%s", "tested_states": [%s], "test_files": [' "$name" "$src" \
      "$(printf '%s' "$uniq_states" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')"
    tf_first=1
    for tf in "${test_files[@]}"; do
      if [ "$tf_first" -eq 1 ]; then tf_first=0; else printf ', '; fi
      printf '"%s"' "$tf"
    done
    printf '] }'
  done
  printf '\n  ]\n}\n'
}

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  emit > "$out"
  printf 'wrote %s\n' "$out"
else
  emit
fi
