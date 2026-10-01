# paqad-ai new project — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `new-project`

## Module Boundaries

Source directories/files owned by this feature:

- `src/cli/commands/new-project.ts`
- `src/onboarding/create-project.ts`

## Entry Points

- CLI entry: `paqad-ai new project <name>`.
- Options: `--provider <provider...>`, `--parent-dir <path>` (default cwd), `--rag` (off unless
  set), `--force`.

## Data Model / Schema

- `CreateProjectResult` — `{ projectRoot, created, gitInitialized, stack: 'undecided',
  generatedFiles, preserved, recovery? }`.
- `UNDECIDED_STACK` (`'undecided'`), `EMPTY_STACK_PROFILE` (empty frameworks/traits/toolchains/…),
  and `UNDECIDED_COMMANDS` (placeholder `echo "choose an application stack first …"` for every
  command). These keep `buildProjectProfile` from applying a framework default.

## API / Interface Contract

- `createProjectWorkspace(options: CreateProjectOptions): Promise<CreateProjectResult>` — the thin
  wrapper. It resolves `projectRoot = join(parentDir, name)`, applies the ENT-03 safe guard, runs
  `git init` only when not already inside a work tree, then delegates to
  `OnboardingOrchestrator.run` with `selections.stack_profile = EMPTY_STACK_PROFILE` and
  `profileOverrides.commands = UNDECIDED_COMMANDS`. No onboarding writer is modified.
- `createNewProjectCommand(): Command` — the commander wiring, registered in `src/cli/program.ts`.

## State Management

- The workspace's `.paqad/` footprint is produced entirely by the reused `OnboardingOrchestrator`;
  this feature adds no new persisted state beyond the undecided-stack profile fields.
- Interruption/resume is handled by the orchestrator's existing onboarding checkpoint; a re-run on
  a directory that already carries `.paqad/` completes the remainder.

## Error Codes

- `PROJECT_DIR_NOT_EMPTY` (`FrameworkError`) — refuses to clobber a non-empty, non-paqad directory;
  recovery: pass `--force` or choose an empty directory.

## Invariants

- INV-1: no application code / stack / SDK / infra is created by this command.
- INV-4: `onboarding/orchestrator.ts`, `install/bootstrap.ts`, `onboarding/prompts.ts` and the
  onboarding writers are untouched; the behaviour is purely additive.
- INV-5: an empty project records no framework and placeholder commands, never a pnpm/react default.
