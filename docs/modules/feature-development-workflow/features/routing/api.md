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

Records the lane on the active change's `feature.json`. It can only raise the lane; a downgrade is refused and reported. Takes `--project-root` and `--session` (defaults to `SE_SESSION`, then `CLAUDE_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, then the shared ledger-session cache).

When one of those flags or variables names the session, not the cache alone, and the route is not already feature development, it also moves the route there, prints the line below and appends a row with `source: "lane-set"`.

## CLI: `paqad-ai stage start <stage>`

Beyond its stage work, this verb moves the route in the same way with `source: "stage-start"` when the session was named by `--session`, `SE_SESSION`, `CLAUDE_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`, rather than read from the shared cache. The `delivery` and `ticket_intake` stages never move it.

```
**▸ paqad** · route set to feature-development: a change was opened in this session.
```

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

// src/pipeline/route-override-log.ts
export type RouteOverrideSource = 'agent-override' | 'stage-start' | 'lane-set';

// src/pipeline/route-switch.ts
export const ROUTE_SWITCHED_LINE: string;
export function writeRouteCorrection(
  root: string,
  sessionId: string,
  target: RoutedWorkflow,
  audit?: { source?: RouteOverrideSource; reason?: string },
): RoutedWorkflow | null;
export function switchRouteToFeatureDevelopment(root: string, sessionId: string, source: RouteOverrideSource): boolean;
export function announceRouteSwitch(root: string, sessionId: string, source: RouteOverrideSource): void;

// src/cli/commands/route.ts
export const UNRESOLVED_SESSION_REASON: string;
```
