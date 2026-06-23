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
#   2. paqad.enabled: false in .paqad/project-profile.yaml ⇒ off.
#   3. absent ⇒ on (default-on; existing behavior unchanged).
#
# Deliberately dist-less: a raw read with no YAML parser and no node, so a
# disabled-and-uninstalled project can still evaluate its own toggle.

# 0 = disabled, 1 = enabled. No args.
paqad_is_disabled() {
  # 1. env override — identical truthy set to the .mjs/.ts primitives.
  case "$(printf '%s' "${PAQAD_DISABLED:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on)
      return 0
      ;;
  esac

  # 2. profile flag. `enabled:` is not unique across the profile, so scope the
  #    match to the top-level `paqad:` block: enter it on a `paqad:` line and
  #    leave it at the next column-0 key, checking only its indented body.
  local root profile
  root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
  profile="${root}/.paqad/project-profile.yaml"
  if [ -f "${profile}" ]; then
    if awk '
      /^paqad:[[:space:]]*$/ { inblock = 1; next }
      /^[^[:space:]#]/        { inblock = 0 }
      inblock && /^[[:space:]]+enabled:[[:space:]]*false([[:space:]]|$)/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "${profile}"; then
      return 0
    fi
  fi

  # 3. default-on.
  return 1
}
