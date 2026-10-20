#!/usr/bin/env bash
set -euo pipefail

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
  echo "[paqad] verification backstop skipped: paqad runtime not found." 1>&2
  exit 0
fi

node "${SCRIPT}" git-backstop
