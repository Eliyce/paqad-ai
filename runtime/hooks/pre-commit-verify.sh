#!/usr/bin/env bash
# Paqad verification backstop (git pre-commit / pre-push) — issue #117 (C-1).
#
# Runs the existing VerificationGateRunner against the working tree via paqad's
# exported `runRepositoryVerification` API and blocks the commit on any failing
# gate. This is the provider-independent layer: it applies to every agent and to
# humans, and (mirrored by the CI step) is the real backstop, since an agent
# cannot pass `--no-verify` to CI.
#
# Honest limitation: a local `git commit --no-verify` bypasses this hook. CI is
# therefore the non-negotiable layer; this hook is fast local feedback.
set -euo pipefail

# Resolve the paqad runtime dir from the framework pointer the agent-entry
# contract already maintains, falling back to node module resolution.
resolve_script() {
  local ref_file=".paqad/framework-path.txt"
  if [ -f "${ref_file}" ]; then
    local runtime
    runtime="$(cat "${ref_file}")"
    runtime="${runtime/#\~/${HOME}}"
    if [ -f "${runtime}/scripts/verify-backstop.mjs" ]; then
      printf '%s' "${runtime}/scripts/verify-backstop.mjs"
      return 0
    fi
  fi
  node -e "process.stdout.write(require('path').join(require('path').dirname(require.resolve('paqad-ai/package.json')),'runtime','scripts','verify-backstop.mjs'))" 2>/dev/null || true
}

SCRIPT="$(resolve_script)"
if [ -z "${SCRIPT}" ] || [ ! -f "${SCRIPT}" ]; then
  # paqad runtime not resolvable from this checkout; do not block the commit.
  echo "[paqad] verification backstop skipped: paqad runtime not found." 1>&2
  exit 0
fi

node "${SCRIPT}" git-backstop
