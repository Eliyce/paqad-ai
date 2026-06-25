#!/usr/bin/env bash
# Issue #220 — the global enable/disable master switch, shell side.
#
# Sourced by every shell enforcement surface so a disabled (or env-overridden)
# project early-exits to a pure no-op before any blocking logic:
#   - lib/agent-entry-sentinel.sh  (→ both entry gates)
#   - decision-pause-gate.sh
#
# Exposes:
#   paqad_is_disabled — returns 0 (disabled) when paqad is off, 1 otherwise.
#
# Precedence (must match runtime/hooks/lib/paqad-disabled.mjs and the TS
# predicate src/core/framework-enabled.ts):
#   1. PAQAD_DISABLED env override (truthy ⇒ off) wins over everything.
#   2. PAQAD_ENABLED=false in .paqad/.config ⇒ off (git-ignored local toggle).
#   3. absent ⇒ on (default-on; existing behavior unchanged).
#
# Deliberately dist-less: a raw read with no parser and no node, so a
# disabled-and-uninstalled project can still evaluate its own toggle.

# 0 = disabled, 1 = enabled. No args.
paqad_is_disabled() {
  # 1. env override — identical truthy set to the .mjs/.ts primitives.
  case "$(printf '%s' "${PAQAD_DISABLED:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on)
      return 0
      ;;
  esac

  # 2. .config flag. Take the last uncommented `PAQAD_ENABLED=` assignment,
  #    strip the key, an inline comment, surrounding quotes and whitespace, then
  #    lowercase. A falsy token means off.
  local root config val
  root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
  config="${root}/.paqad/.config"
  if [ -f "${config}" ]; then
    val=$(grep -E '^[[:space:]]*(export[[:space:]]+)?PAQAD_ENABLED[[:space:]]*=' "${config}" 2>/dev/null \
      | tail -n1 \
      | sed -E 's/^[^=]*=//; s/[[:space:]]#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' \
      | tr '[:upper:]' '[:lower:]')
    case "${val}" in
      false | 0 | no | off)
        return 0
        ;;
    esac
  fi

  # 3. default-on.
  return 1
}
