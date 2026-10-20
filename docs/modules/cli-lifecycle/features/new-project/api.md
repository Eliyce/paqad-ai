# paqad-ai new project — API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `new-project`

## CLI

```
paqad-ai new project <name> [--provider <provider...>] [--parent-dir <path>] [--rag] [--force]
```

Creates a workspace with an undecided application stack, then prints one completion panel: workspace created, application stack UNDECIDED, and one next step, choose your application stack (run discovery, or `paqad-ai onboard` once the stack exists). A non-empty directory is refused with exit code 1 unless `--force` is passed.

## `src/onboarding/create-project.ts`

```ts
export async function createProjectWorkspace(
  options: CreateProjectOptions,
): Promise<CreateProjectResult>;
```

`CreateProjectOptions` takes `name`, and optionally `parentDir`, `providers` (default `['claude-code']`), `rag` and `force`. `CreateProjectResult` returns `projectRoot`, `created`, `gitInitialized`, `stack` (always `'undecided'`), `generatedFiles`, `preserved` and an optional `recovery` note.

## `src/cli/ui/banner.ts`

```ts
export function printNewProjectNextSteps(options: {
  projectRoot: string;
  gitInitialized: boolean;
}): void;
```

The completion panel for `new project`. A path too long for the frame prints as a plain line under it. `onboard` keeps `printNextSteps()`, which is unchanged.
