# paqad-ai setup: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `setup`

## CLI

```
paqad-ai setup plan validate <file>
paqad-ai setup plan show [--project-root <path>]
paqad-ai setup onboard [--project-root <path>] [--providers <provider...>]
paqad-ai setup verify [--project-root <path>]
```

| Command | Exits 1 when |
| --- | --- |
| `setup plan validate <file>` | The file cannot be read or the plan is not valid; each error is printed |
| `setup plan show` | Never. With no `.paqad/setup-plan.json` it says no plan is recorded yet |
| `setup onboard` | The workspace is missing, or no application stack is detected (`no application stack detected`, then the recovery line) |
| `setup verify` | The project is not ready to develop; each blocker is printed |

`setup onboard` defaults `--providers` to the provider the workspace recorded. On success it says whether it re-derived real commands (the workspace was undecided) or kept the existing ones, then whether the project is ready to develop.

## `src/onboarding/setup-plan.ts`

```ts
export const SETUP_PLAN_FILE = '.paqad/setup-plan.json';
export type SetupStepState = 'pending' | 'in_progress' | 'blocked' | 'completed';

export function buildSetupPlan(input: BuildSetupPlanInput): SetupPlan;
export function validateSetupPlan(plan: unknown): { ok: boolean; errors: string[] };
export function writeSetupPlan(projectRoot: string, plan: SetupPlan): string;
export function readSetupPlan(projectRoot: string): SetupPlan | null;
export function advanceSetupStep(
  projectRoot: string,
  stepId: string,
  state: SetupStepState,
): SetupPlan;
```

A `SetupPlan` is `{ schema_version: '1', project_root, slice, created_at, steps }`, and each step is `{ id, description, command, verify, recovery, version?, prerequisite?, state }`. `advanceSetupStep` throws `SETUP_PLAN_NOT_FOUND` with no plan and `SETUP_STEP_UNKNOWN` for an unknown step id.

## `src/onboarding/readiness.ts`

```ts
export interface ReadinessResult {
  ready: boolean;
  checks: { commandsConfigured: boolean; moduleDocsPresent: boolean };
  blockers: string[];
}

export function verifyReadinessToDevelop(projectRoot: string): ReadinessResult;
```

## `src/onboarding/onboard-installed-stack.ts`

```ts
export interface OnboardInstalledStackResult {
  projectRoot: string;
  onboarded: boolean;
  detectedFrameworks: string[];
  providers: AdapterType[];
  commandsRederived: boolean;
  readiness: ReadinessResult;
  recovery?: string;
}

export function onboardInstalledStack(options?: {
  projectRoot?: string;
  providers?: AdapterType[];
}): Promise<OnboardInstalledStackResult>;
```

It throws `WORKSPACE_NOT_FOUND` when there is no workspace, and returns `onboarded: false` with a `recovery` line when no application framework is detected.
