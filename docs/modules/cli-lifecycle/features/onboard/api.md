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

Files onboarding kept because they already existed are returned separately in `OnboardingOutput.kept_files`, and stack drift review targets in `OnboardingOutput.drift_review_targets`. Neither is a warning.

After the rest of its output, `paqad-ai onboard` prints, in this order:

- `Kept <n> existing files unchanged.` as one plain line when any file was kept (`file` when there is one). The paths are not listed.
- `Review these for drift:` followed by each drift review target on its own indented plain line.
- Each warning once, in order, starting with `⚠ `. On a terminal the warning is yellow; otherwise it is plain text.

When all three are empty nothing extra is printed. The full onboard has no JSON or silent mode (`--json` applies only to `--detect`), so these lines are always printed.

## `paqad-ai onboarding` (the onboarding journey)

The journey is driven by an AI tool through the `onboarding-journey` skill. Every verb ends by
rewriting `.paqad/onboarding/view.json`, including a refused call, which keeps every step state
and shows the refusal.

| Verb | What it does |
| --- | --- |
| `start [--providers <list>] [--session <id>] [--allow-list yes\|no] [--asked\|--from-tray]` | Preflight (no open run, no pending packets, `--asked` off a TTY), records the opening answer and writes the local allow list. A second start attaches to the open journey and resumes it. |
| `detect [--json]` | Step 1: runs the detector without persisting; prints `needs_ai_choice` and the candidate stacks when unsure. |
| `choose-stack <stack> [--capabilities <list>] --reason <text>` | Step 1: records the AI pick; refused after step 2 started. |
| `setup [--compile-only]` | Step 2: onboard setup with no questions, search on (local) with the index deferred to Wrap up. |
| `next` | Prints the brief for what to do now (under 27,000 characters). |
| `stage start\|end\|fail <step> [--degraded <codes>] [--planned <n>] [--reason <text>]` | Ordered start gate, proof-checked end gate, closed gap list. There is no skip. |
| `unit <step> <unit> [--outputs <files>] [--kept --source-hash <sha>] [--claim <agent>]` | Records one finished unit (or claims a module for a module agent). |
| `progress <step> <done> <total>` | Batch progress (step 6 records it every 25 rules). |
| `decide <decision-id>` | Answers a packet the journey opened with its recommended option, recorded in choices.jsonl. |
| `status [--json]` | The headline and the step states in words. |
| `choices [--review [ids\|all]]` | Lists automatic choices; reviewing them lets them be reused and lets journey rule checks block. |
| `resume [--session <id>]` | Restarts a stopped or paused step at its first unfinished unit; another session taking over is a hand-over. |
| `finish` | Step 8: search index rebuild in the background, report.json and report.md, then ends the step. |
| `commit --branch [name] \| --later \| --no [--ticket <id>] [--message <subject>]` | The person's answer to the commit question; commits only unchanged journey files on a new branch named by branches.yaml, and never pushes. |
| `abandon` | Pauses the journey and lists everything written so far for review. |

Files: `.paqad/onboarding/journey.json`, `events.jsonl` and `view.json` are git-ignored run state;
`choices.jsonl`, `report.json` and `report.md` are committable.

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
  interactive?: boolean;
  workspacePolicy?: { project_creation_disabled?: boolean };
}

export class OnboardingOrchestrator {
  run(options: OnboardingOptions): Promise<OnboardingOutput>;
}
```

`run` throws a `FrameworkError` with code `PROJECT_CREATION_DISABLED` when the workspace policy turns project creation off.

`interactive: false` stops the provider, stack and RAG questions even when stdin and stdout are a terminal; missing selections fall back to the overrides and detection. `paqad-ai update` runs onboarding this way. Left unset, onboarding asks in a terminal as before.

The manifest `run` writes (`OnboardingManifest`, `.paqad/onboarding-manifest.json`) carries `adapter`, the first selected provider, and `providers`, every selected provider in order.

`OnboardingOutput` (`src/core/types/onboarding.ts`) carries `adapter`, `decision_pause_supported_adapters`, `generated_files`, `detected_modules`, `runtime_root`, `manifest_path`, `warnings`, `kept_files`, `drift_review_targets` and `reverted_framework_values`.

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
