#!/usr/bin/env bash
# Issue #220 / #227 — the global enable/disable master switch, shell side.
#
# Sourced by every shell enforcement surface so a disabled (or env-overridden)
# project early-exits to a pure no-op before any blocking logic:
#   - lib/agent-entry-sentinel.sh  (→ both entry gates)
#   - decision-pause-gate.sh
#
# Exposes:
#   paqad_is_disabled — returns 0 (disabled) when paqad is off, 1 otherwise.
#
# Precedence (must match runtime/hooks/lib/paqad-disabled.mjs and the TS predicate
# src/core/framework-enabled.ts — pinned by the shared golden-fixture test):
#   1. PAQAD_DISABLED env override (truthy ⇒ off) wins over everything.
#   2. `paqad_enable` resolved across the layered config surfaces, highest first:
#        PAQAD_ENABLE env > .paqad/.config (dev-local) > .paqad/configs/.config.*
#        (team, merged sorted last-wins). A falsy token ⇒ off.
#   3. absent ⇒ on (default-on; existing behavior unchanged).
#
# Deliberately dist-less: a raw read with no parser and no node, so a
# disabled-and-uninstalled project can still evaluate its own toggle.

# Echo the last uncommented `KEY=` value in FILE (surrounding quotes + inline
# comment stripped, lowercased). Empty when the key is absent or the file missing.
__paqad_read_key() {
  local file="$1" key="$2"
  [ -f "${file}" ] || return 0
  grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "${file}" 2>/dev/null \
    | tail -n1 \
    | sed -E 's/^[^=]*=//; s/[[:space:]]#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' \
    | tr '[:upper:]' '[:lower:]'
}

# Echo the resolved (lowercased) value of `paqad_enable` across the layered
# surfaces: team configs (merged, sorted last-wins) < local .config < PAQAD_ENABLE.
__paqad_resolve_enable() {
  local root="$1" value="" v dir f
  dir="${root}/.paqad/configs"
  if [ -d "${dir}" ]; then
    # Sorted (C collation) so the last filename wins, matching the TS resolver.
    while IFS= read -r f; do
      [ -e "${f}" ] || continue
      v=$(__paqad_read_key "${f}" 'paqad_enable')
      [ -n "${v}" ] && value="${v}"
    done < <(LC_ALL=C find "${dir}" -maxdepth 1 -name '.config.*' ! -name '.config.example' -type f 2>/dev/null | LC_ALL=C sort)
  fi
  v=$(__paqad_read_key "${root}/.paqad/.config" 'paqad_enable')
  [ -n "${v}" ] && value="${v}" # LOCAL WINS over team
  v=$(printf '%s' "${PAQAD_ENABLE:-}" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "${v}" ] && value="${v}" # env escape hatch wins over both files
  printf '%s' "${value}"
}

# 0 = disabled, 1 = enabled. No args.
paqad_is_disabled() {
  # 1. env hard override — identical truthy set to the .mjs/.ts primitives.
  case "$(printf '%s' "${PAQAD_DISABLED:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on)
      return 0
      ;;
  esac

  # 2. layered `paqad_enable` resolution. A falsy token means off.
  local root resolved
  root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
  resolved=$(__paqad_resolve_enable "${root}")
  case "${resolved}" in
    false | 0 | no | off)
      return 0
      ;;
  esac

  # 3. default-on.
  return 1
}
