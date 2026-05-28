#!/usr/bin/env bash
# Shared sentinel-freshness logic for the paqad agent-entry gates.
#
# Sourced by:
#   - runtime/hooks/agent-entry-gate.sh        (PreToolUse — blocks edits)
#   - runtime/hooks/agent-entry-prompt-gate.sh (UserPromptSubmit — gates every turn)
#
# Both gates must agree on what "the sentinel is fresh" means, so the logic
# lives here and the gates only own their respective enforcement.
#
# Exposes:
#   paqad_project_root   — resolved project root (env-driven)
#   paqad_entry_file     — relative path of the active agent entry file
#   paqad_sentinel       — absolute path to .paqad/.agent-entry-loaded
#
#   paqad_sentinel_state — echoes one of:
#                            "missing"
#                            "stale:<entry-file|framework-path|docs-instructions>"
#                            "fresh"
#                          and deletes the sentinel when stale.

paqad_project_root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
paqad_entry_file="${PAQAD_ENTRY_FILE:-CLAUDE.md}"
paqad_sentinel="${paqad_project_root}/.paqad/.agent-entry-loaded"

paqad_sentinel_state() {
  if [ ! -f "${paqad_sentinel}" ]; then
    echo "missing"
    return 0
  fi

  _paqad_newer() {
    local candidate="${paqad_project_root}/${1}"
    [ -e "${candidate}" ] && [ "${candidate}" -nt "${paqad_sentinel}" ]
  }

  if _paqad_newer "${paqad_entry_file}"; then
    rm -f "${paqad_sentinel}"
    echo "stale:entry-file"
    return 0
  fi

  if _paqad_newer ".paqad/framework-path.txt"; then
    rm -f "${paqad_sentinel}"
    echo "stale:framework-path"
    return 0
  fi

  if [ -d "${paqad_project_root}/docs/instructions" ]; then
    local newer
    newer=$(find "${paqad_project_root}/docs/instructions" -type f -newer "${paqad_sentinel}" -print -quit 2>/dev/null)
    if [ -n "${newer}" ]; then
      rm -f "${paqad_sentinel}"
      echo "stale:docs-instructions"
      return 0
    fi
  fi

  echo "fresh"
}
