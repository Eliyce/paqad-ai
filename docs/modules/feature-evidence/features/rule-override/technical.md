# Rule Stop and Allow Once: Technical View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `rule-override`

## Module Boundaries

- `src/hud/last-block.ts`: the per-session rule-stop record (write, read, mark used, clear).
- `src/rule-scripts/override.ts`: `applyRuleOverride`, the checks before an override is recorded.
- `src/feature-evidence/rule-overrides.ts`: the `rule-overrides.jsonl` bundle file.
- `src/cli/commands/rules.ts`: `paqad-ai rules override`.
- `runtime/claude-plugin/mod/`: the HUD side; it calls the verb through its one `paqad-ai` helper.

## Data Model

The stop record, `.paqad/session/hud/<session>.last-block.json`:

| Field | Meaning |
| --- | --- |
| `rule`, `title` | the rule id and title |
| `file` | the file the edit targeted |
| `tool_use_id` | the stopped tool call |
| `managed` | true when the gate ran with `PAQAD_MANAGED=1` |
| `at` | when |
| `diff` | a short diff of the edit, at most 2048 bytes |
| `token` | 32 hex characters, fresh per stop |
| `used` | set once an override spends the token |
| `session` | the session id |

Each `rule-overrides.jsonl` row: `{ kind: "rule-override", rule, file, tool_use_id, by: "human",
reason?, at, session }`, stamped with the bundle envelope.

## Behaviour

`applyRuleOverride` checks in this order and stops at the first failure:

1. a session id is given;
2. the file is inside the project;
3. a stop is recorded for that session;
4. the stop is not managed, and no managed-settings file
   (`managed-settings.json` or any `managed-settings.d/*.json` in the platform folder) holds a
   hook command containing `paqad-ai hook --managed`;
5. rule and file match the stop, and the tool call does when `--tool-use-id` is given;
6. the token is unused and equal, compared in constant time;
7. there is an active change.

Then it marks the token used and appends the row. No gate is changed by this: every hook keeps
blocking as before, and the only new way past a rule stop is this recorded answer.
