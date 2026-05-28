#!/usr/bin/env bash
# Purpose: For one component source file, emit which states the implementation
#          appears to support — based on conventional signals (selectors, props,
#          data-state attributes, conditional renders). Deterministic detection;
#          the LLM still decides whether the signal is a real implementation.
#
# Usage:   bash scripts/extract-source-states.sh <component-file>
#
# Output:  one TSV row per detected state to stdout:
#            <state>\t<signal>
#          Where <state> ∈ default hover focus disabled loading error empty,
#          and <signal> names the specific evidence (e.g. `:focus-visible`,
#          `data-state="focused"`, `disabled` prop, `loading` conditional).
#          The `default` state is always emitted (every component has it).
#          Diagnostics to stderr.
#
# Exits:   0 ok (incl. empty match list)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

file="${1:-}"
[ -n "$file" ] || { printf 'error: component file is required\n' >&2; exit 2; }
[ -f "$file" ] || { printf 'error: file not found: %s\n' "$file" >&2; exit 2; }

# default — assumed.
printf 'default\timplicit\n'

# hover — accept CSS `:hover`, Tailwind `hover:` utility, data attr, JS handlers.
if grep -qE ':hover\b|\bhover:[a-zA-Z0-9_-]|data-hover|onMouseEnter|onPointerEnter|useHover' "$file"; then
  printf 'hover\tcss-pseudo-or-handler\n'
fi

# focus — accept CSS `:focus(-visible)`, Tailwind `focus:` / `focus-visible:`, data-state, handlers.
if grep -qE ':focus-visible\b|:focus\b|\bfocus(-visible)?:[a-zA-Z0-9_-]|data-state="focused"|onFocus|tabIndex' "$file"; then
  printf 'focus\tcss-pseudo-or-handler\n'
fi

# disabled
if grep -qE '\bdisabled\b|aria-disabled' "$file"; then
  printf 'disabled\tprop-or-aria\n'
fi

# loading
if grep -qE '\bloading\b|isLoading|isPending|Spinner|Skeleton' "$file"; then
  printf 'loading\tprop-or-spinner\n'
fi

# error
if grep -qE '\berror\b|hasError|isError|aria-invalid' "$file"; then
  printf 'error\tprop-or-aria\n'
fi

# empty
if grep -qE '\bempty\b|isEmpty|noResults|noData|EmptyState' "$file"; then
  printf 'empty\tprop-or-empty-render\n'
fi
