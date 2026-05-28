---
'paqad-ai': minor
---

feat(#76): design-test workflow — UI audit against the project's design-system contract

Adds a heavyweight design-test workflow that mirrors pentest but grades the running UI against `docs/instructions/design-system/*`. Intent-routed (no slash command), resumable, 9 skills + readiness gate, 7 framework-owned runners under `runtime/scripts/design/`, Playwright live phase, `DT-XXXX` finding ids with stable `token | component | state | a11y | responsive | motion | copy | performance | documentation-drift` categories. Companion `design-retest` workflow preserves IDs across re-runs.

**Workflow**

- New workflow rules: `runtime/capabilities/coding/rules/design-test.md` + `design-retest.md`.
- 11 design-test routing triggers at priority 235; 4 design-retest triggers at 245.
- `feature-development.yaml` splices design-system reads + per-stage instructions through planning → specification → development → review → checks → documentation_sync (schema-conformant via `merge_mode: append`).

**Skills (the LLM-reasoning layer)**

- `design-system-coverage` (readiness gate, mirrors `stride-threat-model`), `token-conformance-review`, `component-conformance-review`, `state-coverage-review`, `accessibility-review` (WCAG 2.2 A/AA), `responsive-review`, `motion-review`, `copy-and-ia-review`, `design-system-sync`.
- **Hard-coded design values** (hex literals, raw `px`/`rem`, ad-hoc font stacks where a token exists) default to **high severity** — first-class findings, not a stylistic preference.

**Deterministic scripts (the complement to the LLM layer)**

Per the [agentskills.io](https://agentskills.io) contract: 25 small, focused scripts do the mechanical work so the agent doesn't re-derive it on every run. Each script has `--help`, structured stdout, stderr diagnostics, and meaningful exit codes (0 ok, 1 finding, 2 usage).

- design-system-coverage: `count-clauses`, `derive-tier`, `gap-report`
- token-conformance-review: `parse-tokens`, `normalize-color`, `match-leak-to-token`
- component-conformance-review: `derive-inventory`, `parse-components-md`, `diff-inventories`
- state-coverage-review: `extract-source-states`, `extract-tested-states`, `cross-reference-states`
- accessibility-review: `static-a11y-scan`, `parse-axe-violations`, `map-axe-to-wcag`
- responsive-review: `extract-breakpoints`, `find-horizontal-scroll`, `find-touch-target-violations`
- motion-review: `scan-animations`, `parse-motion-budget`, `find-reduced-motion-violations`
- copy-and-ia-review: `extract-user-strings`, `check-action-verbs`, `check-terminology`
- design-system-sync: `detect-token-additions`, `detect-component-additions`, `propose-tokens-diff`, `propose-components-diff`

**Framework runners (zero project footprint)**

`runtime/scripts/design/{scan-tokens, scan-overrides, enumerate-surface, axe-static, coverage, runtime-checks.ts, retest}` — all ship inside paqad-ai; outputs land in the project at `docs/design-test/*` and `.paqad/design-test/runs/*` as work products. Diverges from pentest's project-seeded runner model intentionally; the divergence is documented in the workflow rule.

**Finding normalizer**

`DT-` code prefix, design-test category vocabulary, `blocker | nit` severities + `accepted | waived | still-open | needs-manual-verification` statuses.

**Tests**

~200 fixture-driven test cases under `tests/unit/skills/` + `tests/fixtures/design-skills/<skill>/`. The `coverage-completeness` meta-test enforces that every script is referenced by basename in its spec, passes `bash -n`, and that every backticked path in each `SKILL.md` Resources section exists on disk.

**Skill-authoring rule**

`docs/instructions/rules/_shared/skill-authoring.md` captures the contract for future skills — anatomy, frontmatter, the deterministic-vs-judgment boundary, the script interface contract, portability workarounds (no `mapfile`, no `\b` in awk, BSD grep alternation quirk, missing-trailing-newline guard), and the testing rules. Auto-loaded by the framework entry, so future skills inherit the contract without being told.
