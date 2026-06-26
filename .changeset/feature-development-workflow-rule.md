---
'paqad-ai': minor
---

Activate the feature-development workflow so an LLM actually runs it. Adds `feature-development.md` as a canonical coding-capability rule (mirroring `pentest.md`/`design-test.md`): on any intent to create or change code, the agent must run the feature-development workflow's stages in order — planning, specification, development, review, checks, documentation_sync — honoring each stage's flags and escalations via the Decision Pause Contract, and following `delivery-policy.yaml` on delivery. Previously the stages were declarative YAML that nothing told the agent to execute, so the workflow was never followed on the prompt path (the only seam common to every provider). Every stage is mandatory; the lane sets depth, never omission. A regression guard asserts the rule ships, mirrors into the contract, and keeps every mandatory stage and the do-not-improvise framing.
