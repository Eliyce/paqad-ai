---
'paqad-ai': patch
---

Fast-lane edits are now recorded as development, checks and documentation_sync stages (#590). The pre-mutation edit gate has been lane-aware since #324 — a fast-lane change needs only `planning`, not a frozen spec — but the live stage writer (and the on-entry narration) still demanded both `planning` and `specification` on every lane before it would record an edit. The two disagreed, so a fast-lane change left no `development`, `checks` or `documentation_sync` rows in `stage-evidence.jsonl` even though real source, test and doc edits happened, and the change could read as incomplete or pass with stages that were never recorded live.

The lane-to-required-pre-code-stages decision now lives in one shared helper, `requiredPreCodeStages(lane)`, that both the gate and the writer consult, so they can never drift again. The effective-lane resolver (the `sensitivity: high` → `full` floor, with a null lane failing safe to `full`) has been lifted into a shared `effective-lane` module both sides import, so a fast-lane edit to a high-sensitivity path is held to `full` by the writer exactly as the gate blocks it.
