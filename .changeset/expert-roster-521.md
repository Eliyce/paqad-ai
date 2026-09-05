---
'paqad-ai': minor
---

feat(spec-pipeline): model-driven expert roster, off by default (issue #521, Phase 2)

Adds the Phase 2 expert-roster machinery to the spec pipeline, gated behind the
new off-by-default `spec_pipeline_experts_enabled` flag — with it off, zero Phase 2
code runs and a pipeline run is byte-identical to v1 (P2-INV-1).

The one design change from #521: the expert-need decision is made by a fast-tier
agent-run skill (`expert-need-detector`), not a deterministic Node signal-scorer —
a script cannot reliably tell which expert a request needs and would emit false
signals. The model reads the request + the S0 grounding and returns a need artifact;
the script only validates it against the roster (paqad calls no LLM from Node).

What ships:

- `EXPERT_ROLES` — the expert subset of the canonical `AGENT_ROLES`, budgets from
  `ROLE_TOKEN_BUDGETS` (no parallel roster).
- `validateExpertNeed` / `validateExpertNotes` — reject any role outside the roster
  (AC-8) and any malformed artifact, so the model can never invent an expert.
- Per-expert context-slice sizing that keeps every needed expert and only warns when
  the run token ceiling is exceeded — never drops one (AC-6/INV-5).
- Conflict-aware merge: contradictory expert claims on the same target surface as a
  detected conflict rather than a silent pick (AC-9).
- Per-expert accounting (which/why/tokens/whether it changed the spec, AC-5/AC-7),
  folded into finish provenance only when experts ran.
- `paqad-ai spec pipeline experts record|notes` verbs (hard-gated on the flag) and a
  `doctor` coherence check for the expert config (FR-9).

Enabling the flag and shipping a specific pilot expert stay gated on the FR-9
measurement data (issue #521 AC-1); this change builds the machinery, off by default.
