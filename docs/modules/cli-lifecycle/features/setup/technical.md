# paqad-ai setup — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `setup`

## Module Boundaries

Source directories/files owned by this feature:

- `src/cli/commands/setup.ts`
- `src/onboarding/setup-plan.ts`
- `src/onboarding/readiness.ts`

## Entry Points

- `paqad-ai setup plan validate <file>` — validate a setup-plan JSON file.
- `paqad-ai setup plan show` — print the stored plan (`--project-root`, default cwd).
- `paqad-ai setup verify` — report readiness to develop (`--project-root`); exits non-zero when
  not ready.

## Data Model / Schema

- `SetupPlan` — `{ schema_version: '1', project_root, slice, created_at, steps: SetupStep[] }`.
- `SetupStep` — `{ id, description, command, verify, recovery, version?, prerequisite?, state }`.
- `SetupStepState` — `'pending' | 'in_progress' | 'blocked' | 'completed'`.
- Stored at `.paqad/setup-plan.json` (never inside a feature-evidence bundle dir), atomic write.

## API / Interface Contract

- `buildSetupPlan({ projectRoot, slice, steps, now? }): SetupPlan` — assigns `pending` to every
  step, preserves input (dependency) order, stamps `created_at`.
- `validateSetupPlan(plan): { ok, errors[] }` — deterministic, zero model tokens; rejects a
  non-object, empty/missing steps, a step missing a required field, a duplicate id, a
  forward/unknown prerequisite, or an invalid state (AC-6).
- `writeSetupPlan` / `readSetupPlan` / `advanceSetupStep` — persist, read, and update one step's
  state (throws `SETUP_STEP_UNKNOWN` / `SETUP_PLAN_NOT_FOUND`).
- `verifyReadinessToDevelop(projectRoot): { ready, checks: { commandsConfigured, moduleDocsPresent },
  blockers[] }` — reads the project profile via `readProjectProfile`; `commandsConfigured` is false
  while the commands are the undecided placeholders; `moduleDocsPresent` checks `docs/modules/`.

## State Management

- The only persisted state is `.paqad/setup-plan.json`. Readiness is read-only.
- paqad executes no installer anywhere; step state is advanced explicitly by the owner/host.

## Error Codes

- `SETUP_PLAN_NOT_FOUND` — no stored plan for the project root.
- `SETUP_STEP_UNKNOWN` — `advanceSetupStep` given an id not in the plan.

## Invariants

- BND-04: no code path runs an installer; the plan only records official commands and tracks state.
- INV-2: the record names its slice scope and carries no "parent complete" field.
