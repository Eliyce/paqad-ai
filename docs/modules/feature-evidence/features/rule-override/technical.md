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
| `sole` | true only when rule scripts were the one capability that blocked this call |
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
5. the stop is `sole`;
6. rule and file match the stop, and the tool call does when `--tool-use-id` is given;
7. the token is unused and equal, compared in constant time;
8. there is an active change.

Then it marks the token used and appends the row. No gate is changed by this: every hook keeps
blocking as before, and the only new way past a rule stop is this recorded answer.

## When the HUD offers Allow once

The engine hands the mod one verdict for the whole call: every PreToolUse deny and every
permission rule folded together. So the mod cannot see which gate denied. It offers the three
options only when all of these hold, and otherwise keeps the deny and asks nothing:

1. a fresh stop record exists for this session and this `tool_use_id`, unused;
2. the verdict carries no settings permission `rule`;
3. the stop is not managed (a managed stop shows the organization toast instead);
4. the stop is `sole`, so no other capability on the same gate (for example the stage gate or
   the rules-loaded gate) blocked the call;
5. `.paqad/decisions/pending/` holds no packet, so the decision-pause gate is not denying;
6. the session's entry sentinel `.paqad/.agent-entry-loaded.d/<session>` exists, so the entry
   gate is not denying.

The capability gate writes `sole: true` only when the rule-scripts outcome is the one blocking
outcome on that call. The CLI refuses a stop that is not `sole` as well.

### Known gap

A PreToolUse hook from another tool or plugin that denies the same edit is folded into the same
verdict with no marker the mod can read. When every check above passes, Allow once replaces that
deny too. paqad's own gates and settings rules are covered; a foreign hook's deny is not.

The token sits in plain text in the stop record, so the agent can run `paqad-ai rules override`
itself and write a row marked `by: "human"`. No gate reads `rule-overrides.jsonl`, so the forged
row cannot let an edit through; it only misattributes the evidence. Tracked as tech debt
TD-01M5CW8WGAFVSRZ3AHEKD9VMS8.
