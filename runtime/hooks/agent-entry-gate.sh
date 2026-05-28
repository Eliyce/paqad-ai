#!/usr/bin/env bash
# Paqad agent-entry gate (PreToolUse / mutating-Bash hook).
#
# Blocks any code-mutating tool call until the agent has loaded its provider
# entry file (CLAUDE.md, AGENTS.md, ...) plus the framework entry and
# docs/instructions/{rules,stack,design-system}, and written the per-session
# sentinel at .paqad/.agent-entry-loaded.
#
# Sentinel-freshness logic is shared with agent-entry-prompt-gate.sh via
# lib/agent-entry-sentinel.sh so the two gates cannot drift.
#
# Exit codes:
#   0  → allow the tool call
#   2  → block the tool call (Claude Code surfaces stderr to the model)
set -u

# shellcheck source=lib/agent-entry-sentinel.sh
. "$(dirname "$0")/lib/agent-entry-sentinel.sh"

print_block() {
  echo "[paqad] Blocked: load the paqad framework before editing." 1>&2
  echo "[paqad] Required steps:" 1>&2
  echo "[paqad]   1. Read ${paqad_entry_file}" 1>&2
  echo "[paqad]   2. Resolve .paqad/framework-path.txt and load the framework entry" 1>&2
  echo "[paqad]   3. Load docs/instructions/{rules,stack,design-system}" 1>&2
  echo "[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path" 1>&2
  exit 2
}

state=$(paqad_sentinel_state)
case "${state}" in
  fresh) exit 0 ;;
  *)     print_block ;;
esac
