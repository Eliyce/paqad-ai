---
'paqad-ai': patch
---

feat(spec-pipeline): requirement-enrichment emits FR-4 two-layer question objects (B.5.2)

The `requirement-enrichment` skill is the spec pipeline's S2 question-phrasing step (deferred from #512). It now emits the FR-4 two-layer question batch the `questions` step consumes — `{ questions: [{ business_text, why_it_matters, options[], grounded_in, technical_note? }] }` — instead of three flat markdown sections. It phrases on the cheap (`fast`) model tier, drawing vocabulary in priority order (S0 grounding terms → the user's prompt → plain English), with options phrased as outcomes not mechanisms and a `grounded_in` reference (or `null`) per question. The plain-language check stays the pipeline's job (`checkPlainLanguage`); the skill only phrases. `assets/output.template.md` and `scripts/lint-output.sh` were updated together to the new JSON shape.
