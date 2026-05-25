#!/usr/bin/env bash
# Paqad agent-entry gate (PreToolUse / mutating-Bash hook).
#
# Blocks any code-mutating tool call until the agent has loaded its provider
# entry file (CLAUDE.md, AGENTS.md, ...) plus the framework entry and
# docs/instructions/{rules,stack,design-system}, and written the per-session
# sentinel at .paqad/.agent-entry-loaded.
#
# The sentinel is invalidated when the entry file, framework-path.txt, or any
# file under docs/instructions/ is newer than the sentinel — forcing a reload
# mid-session.
#
# Exit codes:
#   0  → allow the tool call
#   2  → block the tool call (Claude Code surfaces stderr to the model)
set -u

project_root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
sentinel="${project_root}/.paqad/.agent-entry-loaded"

print_block() {
  local entry_file="${1}"
  echo "[paqad] Blocked: load the paqad framework before editing." 1>&2
  echo "[paqad] Required steps:" 1>&2
  echo "[paqad]   1. Read ${entry_file}" 1>&2
  echo "[paqad]   2. Resolve .paqad/framework-path.txt and load the framework entry" 1>&2
  echo "[paqad]   3. Load docs/instructions/{rules,stack,design-system}" 1>&2
  echo "[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path" 1>&2
  exit 2
}

# Detect the active entry file. Default to CLAUDE.md (this hook is Claude Code
# specific); other adapters can re-use the script and pass PAQAD_ENTRY_FILE.
entry_file="${PAQAD_ENTRY_FILE:-CLAUDE.md}"

if [ ! -f "${sentinel}" ]; then
  print_block "${entry_file}"
fi

# Sentinel exists — make sure it's still fresh. If any tracked source is newer
# than the sentinel, treat it as invalidated and require a reload.
needs_reload() {
  local candidate="${project_root}/${1}"
  [ -e "${candidate}" ] && [ "${candidate}" -nt "${sentinel}" ]
}

if needs_reload "${entry_file}" \
  || needs_reload ".paqad/framework-path.txt"; then
  rm -f "${sentinel}"
  print_block "${entry_file}"
fi

# Check docs/instructions tree (any file newer than the sentinel).
if [ -d "${project_root}/docs/instructions" ]; then
  newer=$(find "${project_root}/docs/instructions" -type f -newer "${sentinel}" -print -quit 2>/dev/null)
  if [ -n "${newer}" ]; then
    rm -f "${sentinel}"
    print_block "${entry_file}"
  fi
fi

exit 0
