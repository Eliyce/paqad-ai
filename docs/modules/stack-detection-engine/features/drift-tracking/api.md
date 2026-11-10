# Drift Tracking: API View

> Module: **Stack Detection Engine** (`stack-detection-engine`) · Layer: `framework-internals` · Feature slug: `drift-tracking`

## Files

- `.paqad/stack-snapshot.json` and `.paqad/stack-drift.json`: the detected stack and its drift.
- `.paqad/ledger/rules-discovery/baseline.json`: the stack baseline rules discovery compares
  against. Seeded from the stack snapshot; moved only by a rules discovery run that applies a
  signed-off proposal or finds the rules current.
- `.paqad/rules-discovery-nudge.json` (git-ignored): hash of the package set the SessionStart
  drift line last showed, so the line shows once per set.

## CLI

- `paqad-ai rules inventory`: list the current rules for a run.
- `paqad-ai rules discovery start | status`: open or resume a run, and show its step.
- `paqad-ai rules discovery decisions | research | propose | sign-off | apply | docs`: the run's
  steps in order. `apply` writes only after the owner signs off the `rules.proposal` decision.
  `docs` refreshes the managed blocks between `<!-- paqad:stack:<name>:start -->` markers in
  `docs/instructions/stack/` (`overview.md`, `dependencies.md`, `versions.md`) and keeps
  hand-written text outside them.

Command source: `src/cli/commands/rules-discovery.ts`. The step list is `RUN_STEPS` in
`src/rules-discovery/run-store.ts`.
