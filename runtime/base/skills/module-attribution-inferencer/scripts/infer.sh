#!/usr/bin/env bash
# Purpose: Run the module-attribution inferencer over a prompt file.
#          Use only when the extractor returned no candidates.
# Usage:   bash scripts/infer.sh <prompt-file> [project-root] [max-choices]
#          project-root defaults to the current directory.
#          max-choices defaults to the engine's default (currently 3).
# Output:  JSON on stdout (hypothesis + alternatives).
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

prompt_file="$1"
project_root="${2:-$PWD}"
max_choices="${3:-}"

[ -f "$prompt_file" ] || { printf 'error: prompt file not found: %s\n' "$prompt_file" >&2; exit 2; }

args=(module-decisions infer --project-root "$project_root" --prompt-file "$prompt_file")
[ -n "$max_choices" ] && args+=(--max-choices "$max_choices")

exec paqad-ai "${args[@]}"
