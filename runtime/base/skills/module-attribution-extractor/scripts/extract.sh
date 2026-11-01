#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "" ]; then
  cat <<'USAGE'
Purpose: Run the module-attribution extractor over a prompt file.
Usage:   bash scripts/extract.sh <prompt-file> [project-root]
         project-root defaults to the current directory.
Output:  JSON on stdout (candidates + needs_decision).
Exits:   0 ok | 2 usage error
USAGE
  case "${1:-}" in --help|-h) exit 0 ;; esac
  exit 2
fi

prompt_file="$1"
project_root="${2:-$PWD}"

[ -f "$prompt_file" ] || { printf 'error: prompt file not found: %s\n' "$prompt_file" >&2; exit 2; }

exec paqad-ai module-decisions extract \
  --project-root "$project_root" \
  --prompt-file "$prompt_file"
