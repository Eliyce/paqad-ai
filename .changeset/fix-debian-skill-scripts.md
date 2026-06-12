---
'paqad-ai': patch
---

Make the shipped skill scripts portable to Debian and immune to a SIGPIPE race.

Two real defects surfaced by running the test suite in `node:22-bookworm`
and `node:24-bookworm` containers:

- Debian's default awk is mawk, which silently fails to match `{n,m}`
  interval expressions. The copy-and-ia-review scripts used intervals inside
  awk `match()` calls, so `extract-user-strings.sh` dropped every jsx-text
  row and `check-action-verbs.sh` produced no output on Debian while
  gawk-based CI stayed green. The awk patterns now use `+` with an explicit
  `length()` cap, and a guard test rejects any future awk `match()` interval.

- Under `set -o pipefail`, `printf '%s' "$body" | grep -qE pattern` fails
  with status 141 exactly when the pattern matches early: `grep -q` exits on
  first match and printf dies of a silent SIGPIPE. The `|| say` validation
  idiom then recorded a plausible-looking finding, which is why lint scripts
  intermittently rejected valid input on loaded runners. All 166 occurrences
  across 60 scripts now use herestrings (`grep -q pattern <<<"$var"`), which
  cannot race, and a guard test keeps pipelines from feeding `grep -q` again.

The test harness retry gate also tightened: it retries only results with no
output at all (or infrastructure-flavored stderr), so specs that expect a
non-zero exit no longer burn the full backoff, and a `PAQAD_DEBUG_RUNSCRIPT`
hook records non-zero results for future flake forensics.
