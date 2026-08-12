---
'paqad-ai': patch
---

fix(#472): reconcile the completion receipt so its headline and per-stage block agree

The end-of-change receipt (#325) composed two independent subsystems without reconciling them: the verdict headline (`formatVerdictSummary`, driven by `verdict.ok`, computed from gates only) and the per-stage evidence block (the stage-evidence fold). A feature-development change whose gates all passed but whose mandatory `review`/`checks` stages had no evidence rendered a self-contradicting receipt — `Safe to merge / N/N checks held` beside `🟡 review/checks — not recorded`. It happened whenever a mandatory-stage gap did not flip `verdict.ok` (for example `stages_mode=warn`, where the stage-evidence gate is `skipped`).

The receipt now reconciles **down** (the contract's own over-trust guard): when a feature-development change's gates all pass but a mandatory stage is not provably done, the developer-facing verdict word becomes **Inconclusive** and names the offending stages, so the headline agrees with the per-stage block. The true `🟢 N/N checks held for you.` line is kept, so gate evidence is still credited.

`verdict.ok` stays gate-derived, so git/CI exit codes and warn-mode non-blocking semantics are unchanged — Inconclusive is "do not over-trust", never a hard block. (Defect 2, the #409 narration advisory, was already fixed by #476; this closes Defect 1.)
