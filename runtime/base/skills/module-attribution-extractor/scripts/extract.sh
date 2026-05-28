#!/usr/bin/env bash
# Purpose: Run the module-attribution extractor over a prompt file.
# Usage:   bash scripts/extract.sh <prompt-file> [project-root]
#          project-root defaults to the current directory.
# Output:  JSON on stdout (candidates + needs_decision).
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "" ]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

prompt_file="$1"
project_root="${2:-$PWD}"

[ -f "$prompt_file" ] || { printf 'error: prompt file not found: %s\n' "$prompt_file" >&2; exit 2; }

exec paqad-ai module-decisions extract \
  --project-root "$project_root" \
  --prompt-file "$prompt_file"
