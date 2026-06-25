#!/usr/bin/env bash
# Paqad agent-entry prompt gate (UserPromptSubmit hook).
#
# Fires on every user prompt — including read-only Q&A — so the agent cannot
# answer in an onboarded project without first loading its provider entry file
# (CLAUDE.md, AGENTS.md, ...) plus the framework and
# docs/instructions/{rules,stack,design-system}.
#
# This complements the PreToolUse gate (agent-entry-gate.sh), which only fires
# on code-mutating tool calls and therefore does not gate answer-only turns.
#
# Modes (selected via PAQAD_AGENT_ENTRY_MODE):
#   soft (default) — print a high-priority reminder on stdout. Claude Code
#                    injects UserPromptSubmit stdout into the model context,
#                    so the agent sees the reminder before planning the turn.
#                    Exits 0.
#   hard           — exit non-zero with a blocking message. Strongest
#                    guarantee; noisier UX.
#
# Sentinel-freshness logic is shared with agent-entry-gate.sh via
# lib/agent-entry-sentinel.sh.
set -u

# shellcheck source=lib/agent-entry-sentinel.sh
. "$(dirname "$0")/lib/agent-entry-sentinel.sh"

# Issue #220 — when paqad is disabled (or env-overridden off), the gate is a
# pure no-op. This MUST short-circuit before the soft-mode stdout reminder below,
# not just the hard-mode exit 2: an injected `[paqad]` line would contaminate the
# OFF arm's context in an A/B comparison.
if paqad_is_disabled; then
  exit 0
fi

mode="${PAQAD_AGENT_ENTRY_MODE:-soft}"

state=$(paqad_sentinel_state)
if [ "${state}" = "fresh" ]; then
  exit 0
fi

reason_human() {
  case "${state}" in
    missing)                  echo "the per-session sentinel .paqad/.agent-entry-loaded is missing" ;;
    stale:entry-file)         echo "${paqad_entry_file} changed mid-session — the sentinel was invalidated" ;;
    stale:framework-path)     echo ".paqad/framework-path.txt changed mid-session — the sentinel was invalidated" ;;
    stale:docs-instructions)  echo "docs/instructions/ changed mid-session — the sentinel was invalidated" ;;
    *)                        echo "the sentinel is not fresh (${state})" ;;
  esac
}

reason=$(reason_human)

emit_message() {
  local stream="${1}"
  {
    echo "[paqad] You MUST load the paqad framework before responding."
    echo "[paqad] Reason: ${reason}."
    echo "[paqad] Required steps, in order, before any other tool call or response:"
    echo "[paqad]   1. Read ${paqad_entry_file}"
    echo "[paqad]   2. Resolve .paqad/framework-path.txt and load + follow the framework bootstrap (AGENT-BOOTSTRAP.md in the install)"
    echo "[paqad]   3. Load docs/instructions/{rules,stack,design-system}"
    echo "[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path"
    echo "[paqad] Only after step 4 may you address the user's prompt."
  } >&"${stream}"
}

case "${mode}" in
  hard)
    emit_message 2
    exit 2
    ;;
  soft|*)
    emit_message 1
    exit 0
    ;;
esac
