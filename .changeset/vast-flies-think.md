---
'paqad-ai': minor
---

feat(#76): design-test workflow — UI audit against the project's design-system contract

Adds a heavyweight design-test workflow that mirrors pentest but grades the running UI against `docs/instructions/design-system/*`. Intent-routed (no slash command), resumable, 9 skills + readiness gate, 7 framework-owned runners under `runtime/scripts/design/`, Playwright live phase, `DT-XXXX` finding ids with stable `token | component | state | a11y | responsive | motion | copy | performance | documentation-drift` categories.

- New workflow rules: `runtime/capabilities/coding/rules/design-test.md` + `design-retest.md`.
- New skills: `design-system-coverage` (readiness gate, mirrors `stride-threat-model`), `token-conformance-review` (hard-coded values default to **high** severity), `component-conformance-review`, `state-coverage-review`, `accessibility-review` (WCAG 2.2 A/AA), `responsive-review`, `motion-review`, `copy-and-ia-review`, `design-system-sync`.
- New runners (framework-owned, zero project footprint): `scan-tokens.sh`, `scan-overrides.sh`, `enumerate-surface.sh`, `axe-static.sh`, `coverage.sh`, `runtime-checks.ts`, `retest.sh`.
- Routing rules: 11 new design-test triggers at priority 235; 4 design-retest triggers at 245.
- `finding-normalizer`: adds `DT-` code prefix, design-test categories, and the `blocker | nit` severities + `accepted | waived | still-open | needs-manual-verification` statuses the design-test workflow uses.
- `docs/instructions/workflows/feature-development.yaml`: splices design-system reads + per-stage instructions; `checks` stage invokes the diff-scoped design-test runner.

Hard-coded design values (hex literals, raw px/rem, ad-hoc font stacks where a token exists) are now first-class findings at high severity by default.
