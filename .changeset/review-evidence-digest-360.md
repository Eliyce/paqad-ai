---
'paqad-ai': minor
---

Give the review stage hard facts, and make ignoring them detectable (#360).

`paqad-ai review digest` composes `.paqad/session/review-digest.md` from what
paqad already computed — rule-script findings, duplication findings, the check
verdict, failing verification gates — alongside the frozen acceptance criteria,
the per-stage state, and an honest list of the blind spots no machine covers.
It reads cached JSON only: no subprocess, no scan, no model tokens, hard-capped
at 150 lines.

The review stage contract now tells the model to build and read it before
writing findings, and `ImplementationReviewGate` fails when a deterministic,
file-anchored, high-severity finding is never cited by `file:line` in the
recorded `review.json`. The gate re-derives those rows from the same collector
the digest uses, so skipping the verb does not disarm the check. A change with
no machine findings behaves exactly as before.
