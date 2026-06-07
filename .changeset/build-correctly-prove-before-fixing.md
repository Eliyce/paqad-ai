---
'paqad-ai': minor
---

feat: never fix a problem without first proving it exists (#103)

A behaviour-affecting fix now follows a four-step protocol — prove broken, fix, prove fixed, prove
nothing else broke — and the proof is kept as a durable regression guard so the same defect cannot
silently return. The proof is validated as genuine (re-run against the unfixed tree must fail);
trivially-passing proofs are rejected. After the fix, the full check set runs and any newly-failing
previously-passing check rejects the fix, reusing the existing test-output delta projection — no parallel
result store. Problems that genuinely cannot be auto-checked (timing/appearance) open a single
`fix.proof_method` Decision Pause, asked once and reused by kind. Proof-first is skipped only for changes
that cannot affect behaviour (comments, blank lines, docs); when in doubt, the change is treated as
behaviour-affecting, so the fast lane stays light for cosmetic edits.
