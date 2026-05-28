#!/usr/bin/env bash
# Purpose: Render a unified-diff hunk proposing one or more new component
#          entries for components.md. Each entry follows the default skeleton
#          documented in references/sync-rules.md (TBD composition flagged
#          for the user to fill in).
#
# Usage:   bash scripts/propose-components-diff.sh
#            Reads stdin: one TSV row per component (<name>\t<source-file>)
#            from detect-component-additions.sh.
#
# Output:  a unified-diff hunk to stdout. Empty input -> empty output.
#          Diagnostics to stderr.
#
# Exits:   0 ok | 2 usage error
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

input=$(cat)
if [ -z "$(printf '%s' "$input" | tr -d '[:space:]')" ]; then
  exit 0
fi

printf -- '--- a/docs/instructions/design-system/components.md\n'
printf -- '+++ b/docs/instructions/design-system/components.md\n'
printf -- '@@ components @@\n'
printf '%s\n' "$input" | awk -F'\t' '
  NF >= 1 && $1 != "" {
    printf "+\n"
    printf "+## %s\n", $1
    printf "+\n"
    printf "+- variants: TBD\n"
    printf "+- states: default, hover, focus, disabled\n"
    printf "+- composition: TBD (set during documentation_sync)\n"
  }
'
