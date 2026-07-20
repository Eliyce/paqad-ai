---
'paqad-ai': minor
---

Plans must now declare reuse (issue #357). `paqad-ai plan compile` requires a `reuse` section recording what existing code was consulted, what the plan will reuse, and why anything new is justified — so a plan can no longer quietly rebuild something the project already has.

The enforcement is deterministic schema validation inside the existing compile verb, costing zero model tokens. First-party reuse claims are cross-checked against the code-knowledge index (an unknown symbol fails with a nearest-match suggestion), and framework-native claims are cross-checked against the resolved stack snapshot. Every check degrades gracefully: a missing index or stack snapshot downgrades the check to a warning rather than blocking, and a project with no detected framework carries no new burden.

The end-of-change receipt's planning line and the per-feature HTML report now surface the declared reuse counts. Existing `plan.json` files stay valid and readable — the section is required on the compile-input side and optional in the stored schema.
