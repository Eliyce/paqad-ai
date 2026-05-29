---
'paqad-ai': patch
---

Fix `design test` workflow scripts that failed on every onboarded project:

- `runtime/scripts/design/scan-tokens.sh` resolved its helper scanner via a
  CWD-relative path, so Step 2 always exited 2 with
  `error: skill scanner missing` when run from anywhere other than the
  runtime root. Now resolves the helper relative to the script's own
  location.
- `runtime/scripts/design/coverage.sh` aborted under macOS's stock Bash 3.2
  (`set -u` + empty-array expansion) whenever the components directory or a
  component's matching tests were empty — the common first-run case. Guarded
  the three vulnerable `"${arr[@]}"` expansions with the
  `${arr[@]+"${arr[@]}"}` idiom.

Closes #86.
