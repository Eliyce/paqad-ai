---
'paqad-ai': patch
---

fix(#528): re-home the checks report into the per-feature evidence bundle

`paqad-ai checks run` now writes its structured report into the active change's bundle
(`.paqad/ledger/feature-evidence/<change>/checks.json`, under the already-ignored `ledger/`
tree) instead of the git-tracked global `.paqad/checks/last-run.json`, which was rewritten on
every run and rode along as noise in unrelated PRs. The completion backstop and review digest
read from the bundle with a global fallback for non-feature-dev sessions, `checks.json` is a
registered (never hard-required) bundle file, and onboarding scrubs any previously-tracked
`.paqad/checks/last-run.json` from git. No change to what the runner runs or to the report
schema — only where it is stored and read.
