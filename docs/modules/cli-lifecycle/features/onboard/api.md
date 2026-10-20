# paqad-ai onboard: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `onboard`

## CLI

```
paqad-ai onboard [--project-root <path>] [--stack <stack>] [--capability <capability...>]
                 [--providers <provider...>] [--rag <on|off>] [--non-interactive]
paqad-ai onboard --detect [--json] [--project-root <path>]
```

| Flag | Meaning |
| --- | --- |
| `--project-root <path>` | Project root, default the current directory |
| `--stack <stack>` | Force the stack. An unknown stack prints the valid list and exits 2 |
| `--capability <capability...>` | Add one or more capabilities |
| `--providers <provider...>` | Pick the providers to wire: `codex-cli`, `antigravity`, `claude-code`, `gemini-cli`, `junie`, `cursor`, `github-copilot`, `windsurf`, `continue`, `aider`, `aiassistant` |
| `--rag <on\|off>` | Force RAG on or off and skip the RAG prompt |
| `--non-interactive` | Never prompt. RAG defaults to off. With no TTY, a missing `--providers`, `--stack` or `--capability` prints `missing --<flag>` and exits 2 |
| `--detect` | Detect the stack and suggested capabilities and write nothing |
| `--json` | With `--detect`, print the detection as JSON |

`--detect --json` prints:

```json
{
  "detected_domain": "<domain or null>",
  "detected_stack": "<stack or null>",
  "detected_capabilities": [],
  "recommended_capabilities": [],
  "confidence": "high | medium | low"
}
```

When npm is not available, only `claude-code` can be wired: it is picked for you, and asking for any other provider exits 2.

Onboarding warnings are returned in `OnboardingOutput.warnings`. Two of them come from the RAG step:

- `search index is installing in the background; text search until it is ready` when RAG is on with the local provider and the embedding engine is still being installed. RAG stays on.
- `RAG was turned off: <reason>` when the index could not be built for any other reason. `rag_enabled` is set to false.

A Node project also gets one warning naming the commands it left unmapped: `Commands left unmapped in .paqad/project-profile.yaml (no matching script found): <names>. Add them there if the project has them.`

`paqad-ai onboard` prints every warning once, in order, after the rest of its output. Each line starts with `⚠ `. On a terminal the line is yellow; otherwise it is plain text. When there are no warnings nothing extra is printed. The full onboard has no JSON or silent mode (`--json` applies only to `--detect`), so the lines are always printed.

## `src/onboarding/orchestrator.ts`

```ts
export interface OnboardingOptions {
  projectRoot: string;
  runtimeRoot?: string;
  adapters?: AdapterType[];
  profileOverrides?: Partial<ProjectProfile>;
  selections?: {
    providers?: AdapterType[];
    domain?: 'coding' | 'content';
    stack_profile?: ProjectProfile['stack_profile'];
    stack?: Stack;
    capabilities?: Capability[];
    rag?: RagSelection;
  };
  onPhase1Complete?: (result: OnboardingOutput) => void;
  forceOverwrite?: boolean;
  workspacePolicy?: { project_creation_disabled?: boolean };
}

export class OnboardingOrchestrator {
  run(options: OnboardingOptions): Promise<OnboardingOutput>;
}
```

`run` throws a `FrameworkError` with code `PROJECT_CREATION_DISABLED` when the workspace policy turns project creation off.

`OnboardingOutput` (`src/core/types/onboarding.ts`) carries `adapter`, `decision_pause_supported_adapters`, `generated_files`, `detected_modules`, `runtime_root`, `manifest_path`, `warnings` and `reverted_framework_values`.

## `src/onboarding/rag-onboarding.ts`

```ts
export interface RagSelection {
  enabled: boolean;
  provider?: EmbeddingProviderName;
  model?: string;
}

export const RAG_ENGINE_INSTALLING_LINE: string;
export function ragEngineInstallingInBackground(
  projectRoot: string,
  ragSelection: RagSelection,
  env?: NodeJS.ProcessEnv,
): boolean;
```

`ragEngineInstallingInBackground` is true only for the local provider, when the engine is not ready and the background install started or is already running. The install then builds the index for `projectRoot` once the engine is in.
