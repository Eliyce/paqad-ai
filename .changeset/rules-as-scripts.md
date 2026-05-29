---
'paqad-ai': minor
---

Add **rules-as-scripts** (issue #89): turn the prose rules under
`docs/instructions/rules/**` into deterministic, per-project verification
scripts that run as a sub-step of `feature-development.checks`, so rule
adherence no longer depends solely on the model remembering them.

All prompt-driven — no new user-facing CLI commands:

- `analyze rules` (`rule-analyzer`) — embeds stable `<!-- @rule RL-<hash> -->`
  markers, classifies each rule `deterministic` / `heuristic` / `unverifiable`,
  detects rules already enforced by ESLint/TS/etc., flags conflicts, and writes
  a reviewable `docs/instructions/rules/rule-script-map.yml`.
- `generate rule scripts` (`rule-script-generator`) — authors one `.mjs` per
  rule plus synthetic `__fixtures__/{pass,fail}`. A script that misclassifies
  its own fixtures is rejected via the Decision Pause Contract — never
  registered. Strict from generation; per-kind over-flag guard.
- `feature-development.checks.rule_compliance` runs the registered scripts
  diff-scoped, hash-cached. `deterministic` findings block under `mode: strict`;
  `heuristic` findings route to review and never block. Missing declared
  binaries are reported and skipped, never crash the stage.
- `add rule` / `edit rule` / `remove rule` / `mark rule as unverifiable`
  (`rule-editor`) — per-rule cascade with stable IDs; no global rebuild.
- `rule-script-reconciler` surfaces `RS-*` drift (rules edited without regen,
  manual map edits, failing fixtures) at planning entry.
- New dashboard **Rule Compliance** card; onboarding plants the `analyze rules`
  prompt. Engine exposed as the `paqad-ai/rule-scripts` subpath export.
- `finding-normalizer` promoted from the security capability to base so its
  cross-capability vocabulary (`PEN-`/`DT-`/`MD-`/`RS-`) is no longer nested
  under one capability.

Provider-neutral: the same prompt sequence and skills produce identical
artifacts across every supported adapter.
