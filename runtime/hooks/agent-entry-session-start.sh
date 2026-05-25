#!/usr/bin/env bash
# Paqad agent-entry sentinel reset (SessionStart hook).
#
# Every new session must start ungated — delete the sentinel so the agent is
# forced to load its provider entry file again.
set -u

project_root="${CLAUDE_PROJECT_DIR:-${PAQAD_PROJECT_ROOT:-$(pwd)}}"
rm -f "${project_root}/.paqad/.agent-entry-loaded"
exit 0
