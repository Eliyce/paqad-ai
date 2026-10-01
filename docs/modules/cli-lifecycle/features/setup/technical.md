# paqad-ai setup — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `setup`

## Module Boundaries

Source directories/files owned by this feature:

- `src/cli/commands/setup.ts`
- `src/onboarding/setup-plan.ts`
- `src/onboarding/readiness.ts`
- `src/onboarding/onboard-installed-stack.ts`

## Entry Points

- `paqad-ai setup plan validate <file>` — validate a setup-plan JSON file.
- `paqad-ai setup plan show` — print the stored plan (`--project-root`, default cwd).
- `paqad-ai setup onboard` — onboard the actual installed stack of a created workspace (SET-03;
  `--project-root`, `--providers`). Exits non-zero when no application stack is detected.
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
- `onboardInstalledStack({ projectRoot?, providers? }): Promise<OnboardInstalledStackResult>` —
  SET-03/SET-05. Requires an existing workspace (throws `WORKSPACE_NOT_FOUND` otherwise), detects
  the installed stack with `StackIntrospector`, and **refuses** (`onboarded: false`, with a
  `recovery`) when no application framework is detected so an empty workspace never falls through
  to a framework default (ENT-02). Otherwise it drives `OnboardingOrchestrator.run` with the
  detected stack, re-deriving real commands only when the workspace is still undecided
  (`commandsRederived`) and preserving every team-owned setting via the orchestrator's existing
  config-preservation and entry-file skip-if-present behaviour (INV-6). The onboarding engine is
  reused, never modified (INV-4).
- `isUndecidedCommand(command)` / `isUndecidedCommands(commands)` (in `create-project.ts`) — the
  single source of truth for the undecided-placeholder marker; shared by readiness and the
  installed-stack onboarding.

## State Management

- The only persisted state is `.paqad/setup-plan.json`. Readiness is read-only.
- paqad executes no installer anywhere; step state is advanced explicitly by the owner/host.

## Error Codes

- `SETUP_PLAN_NOT_FOUND` — no stored plan for the project root.
- `SETUP_STEP_UNKNOWN` — `advanceSetupStep` given an id not in the plan.
- `WORKSPACE_NOT_FOUND` — `onboardInstalledStack` run against a directory with no paqad workspace.

## Invariants

- BND-04: no code path runs an installer; the plan only records official commands and tracks state.
- INV-2: the record names its slice scope and carries no "parent complete" field.
- INV-4 / INV-6: `setup onboard` reuses the onboarding engine unchanged; a re-onboard preserves
  team-owned settings and never overwrites decided commands (SET-05).
- ENT-02 / SET-03: `setup onboard` refuses rather than deriving a framework default when no stack
  is installed — "an empty bootstrap is not full application onboarding".
