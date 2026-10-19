# Lane & Complexity Routing — API View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `routing`

Routing has no HTTP surface. Its API is two CLI verbs and a few exported functions.

## CLI: `paqad-ai route set <workflow>`

Sets this session's active route to `<workflow>`, one of: `feature-development`, `project-question`, `documentation-update`, `module-documentation`, `pentest`, `design-test`, `codebase-health`, `site-map`, `rules-analyze`, `root-cause-analysis`, `discovery`, `no-workflow`.

| Flag | Meaning |
|---|---|
| `--session <id>` | Session id. Defaults to `SE_SESSION`, then `CLAUDE_SESSION_ID`, then the shared ledger-session cache. |
| `--reason <text>` | Why the hook's label was wrong. Recorded in the audit row. |
| `--project-root <path>` | Project root. Default: the current directory. |

Behaviour:

- Prints `**▸ paqad** · route set to <workflow>` on success.
- Exits 1 with `cannot leave feature-development: source files were edited this turn. Finish or revert the change first.` when this session edited source this turn and the target is not feature development.
- With no `--session`, `SE_SESSION` or `CLAUDE_SESSION_ID`, the edited-this-turn check is skipped and the audit row's `reason` includes `UNRESOLVED_SESSION_REASON`.
- If the target is in the paused stack, the most recent matching entry is resumed and removed from the stack.
- Appends `{ source: "agent-override", ts, hook_label, agent_label, reason? }` to `.route-overrides.jsonl` in the session's stage-evidence ledger.

## CLI: `paqad-ai lane set <fast|graduated|full>`

Records the lane on the active change's `feature.json`. It can only raise the lane; a downgrade is refused and reported. Takes `--project-root` and `--session` (same defaults as above).

## TypeScript

```ts
// src/pipeline/pre-classifier.ts
export function isAboutWorkPrompt(requestText: string): boolean;

// src/pipeline/prompt-lane.ts
export const SYSTEM_NOTIFICATION_BANNER = '[system notification - not user input]';
export const SUBAGENT_HANDBACK_MARKERS: { element: 'agent-message'; label: '[subagent hand-back]' };
export function isSystemNotificationPrompt(prompt: string): boolean;

// src/pipeline/session-ownership.ts
export function editedDevelopmentThisTurn(projectRoot: string, sessionId: string): boolean;

// src/cli/commands/route.ts
export const UNRESOLVED_SESSION_REASON: string;
```
