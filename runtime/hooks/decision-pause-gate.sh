#!/usr/bin/env bash
# Paqad decision-pause gate (PreToolUse / mutating-tool hook) — issue #117 (C-3).
#
# Blocks any code-mutating tool call while an unresolved decision packet exists
# in .paqad/decisions/pending/. Generalises the agent-entry-gate.sh pattern: the
# decision-pause contract was instruction-only until now; this makes it binding
# on hook-capable hosts. The completion/backstop run (verify-backstop.mjs) is
# the second layer — it fails the implementation-review gate when a change lands
# against an unresolved packet, so the contract holds even where this live hook
# is unavailable.
#
# Exit codes:
#   0  → allow the tool call (no pending decision)
#   2  → block the tool call (host surfaces stderr to the model)
set -u

# shellcheck source=lib/paqad-disabled.sh
. "$(dirname "$0")/lib/paqad-disabled.sh"

# Issue #220 — when paqad is disabled (or env-overridden off), the gate is a
# pure no-op: never block on a pending packet, write nothing.
if paqad_is_disabled; then
  exit 0
fi

PENDING_DIR=".paqad/decisions/pending"

shopt -s nullglob
pending=("${PENDING_DIR}"/D-*.json)
shopt -u nullglob

if [ ${#pending[@]} -eq 0 ]; then
  exit 0
fi

ids=""
for packet in "${pending[@]}"; do
  id="${packet##*/}"
  id="${id%.json}"
  ids="${ids:+${ids}, }${id}"
done

echo "[paqad] Blocked: a decision pause is open. Resolve it before editing." 1>&2
echo "[paqad] Pending decision packet(s): ${ids}" 1>&2
echo "[paqad] Answer the packet (AskUserQuestion / decision UI), then continue." 1>&2
exit 2
