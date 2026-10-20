#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'USAGE'
Purpose: Render a unified-diff hunk proposing one or more new token entries
         for tokens.md. The hunk is what the LLM shows the user via the
         Decision Pause Contract before applying.

Usage:   bash scripts/propose-tokens-diff.sh
           Reads stdin: one TSV row per token (key<TAB>value) from
           detect-token-additions.sh.

Output:  a unified-diff hunk to stdout, suitable for surfacing to the user.
         Diagnostics to stderr.

USAGE
  exit 0
fi

input=$(cat)
if [ -z "$(printf '%s' "$input" | tr -d '[:space:]')" ]; then
  exit 0
fi

printf -- '--- a/docs/instructions/design-system/tokens.md\n'
printf -- '+++ b/docs/instructions/design-system/tokens.md\n'
printf -- '@@ tokens @@\n'
printf '%s\n' "$input" | awk -F'\t' '
  NF >= 2 && $1 != "" && $2 != "" {
    printf "+- %s = %s\n", $1, $2
  }
'
