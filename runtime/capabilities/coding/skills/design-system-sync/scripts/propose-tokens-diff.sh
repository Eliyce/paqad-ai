#!/usr/bin/env bash
# Purpose: Render a unified-diff hunk proposing one or more new token entries
#          for tokens.md. The hunk is what the LLM shows the user via the
#          Decision Pause Contract before applying.
#
# Usage:   bash scripts/propose-tokens-diff.sh
#            Reads stdin: one TSV row per token (key<TAB>value) from
#            detect-token-additions.sh.
#
# Output:  a unified-diff hunk to stdout, suitable for surfacing to the user.
#          Diagnostics to stderr.
#
# Exits:   0 ok (incl. empty input -> empty diff)
#          2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# Slurp stdin so we know whether there is anything to propose.
input=$(cat)
if [ -z "$(printf '%s' "$input" | tr -d '[:space:]')" ]; then
  exit 0
fi

# Emit a minimal unified-diff hunk targeting tokens.md.
printf -- '--- a/docs/instructions/design-system/tokens.md\n'
printf -- '+++ b/docs/instructions/design-system/tokens.md\n'
printf -- '@@ tokens @@\n'
printf '%s\n' "$input" | awk -F'\t' '
  NF >= 2 && $1 != "" && $2 != "" {
    printf "+- %s = %s\n", $1, $2
  }
'
