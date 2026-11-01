# paqad-ai join: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `join`

## CLI

```
paqad-ai join [--project-root <path>] [--interactive] [--no-rag] [--yes] [--non-interactive]
```

`join` sets up an already-onboarded project on this machine. It writes only git-ignored files and files under the user home, and never changes a tracked file.

| Option | Effect |
| --- | --- |
| `--project-root <path>` | The project to set up. Defaults to the current folder. |
| `--interactive` | Ask before building the local RAG index. |
| `--no-rag` | Skip the RAG step. |
| `--yes` | Build the RAG index without asking. |
| `--non-interactive` | Never ask; build the RAG index without asking. |

## Output

`join` prints plain lines, one per outcome:

| Case | Line |
| --- | --- |
| Not onboarded (no manifest or profile) | `This project has not been onboarded yet. Ask the project lead to run \`paqad-ai onboard\`, or run it yourself if you are the lead.` (thrown as an error) |
| The repo has no team setup for Claude Code | `This repo does not carry the paqad team setup yet, so teammates and cloud sessions do not get paqad on their own. Ask the project lead to run \`paqad-ai update\` and commit the result.` |
| RAG is off | `RAG is off for this project, nothing to build.` |
| A valid RAG index exists | `RAG index is already present and valid, nothing to build.` |
| The RAG index is built | `Building your local RAG index (this stays on your machine and is not committed)...` |
| Done | `Ready. Your machine is set up for this project. No tracked files changed.` |

The team setup line appears only when the project uses Claude Code, `team_bootstrap_enabled` is on, and `.paqad/hook.mjs`, the team keys in `.claude/settings.json` or one of the `.claude/agents/paqad-*.md` files is missing.

## Claude Code settings

When `.paqad/hook.mjs` is present, the git-ignored Claude settings get the launcher lines `node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" <script>.mjs [args]`. Until it is present, they get the plain npm hook lines `node "<framework home>/hooks/<script>.mjs" [args]`, so no hook ever points at a missing launcher. With `team_bootstrap_enabled=false` the npm lines go to `.claude/settings.local.json`, as on onboarding. Every file is written only when git ignores it.

## `src/cli/commands/join.ts`

```ts
export interface JoinProjectOptions {
  projectRoot: string;
  interactive?: boolean;
  rag?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
}

export function createJoinCommand(): Command;
export function joinProject(options: JoinProjectOptions): Promise<void>;
export { deriveRecordedProviders } from '@/adapters/recorded-providers.js';
```

## `src/adapters/claude/claude-adapter.ts`

```ts
class ClaudeCodeAdapter {
  joinSettingsFiles(projectRoot: string, env?: NodeJS.ProcessEnv): GeneratedFile[];
}
```

`joinSettingsFiles` returns the plain npm form while the team setup is on but `.paqad/hook.mjs` is missing, and the same Claude files onboarding writes otherwise.
