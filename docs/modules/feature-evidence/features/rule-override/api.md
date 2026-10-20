# Rule Stop and Allow Once: API View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `rule-override`

## `paqad-ai rules override`

```text
paqad-ai rules override --rule <id> --file <path> --token <token>
                        [--tool-use-id <id>] [--reason <text>]
                        [--project-root <path>] [--session <id>]
```

- `--rule`, `--file`: as named by the stop.
- `--token`: the one-time token from the stop record.
- `--tool-use-id`: the stopped call; when given it must match.
- `--reason`: why the person allowed it; kept on the row.
- `--session`: defaults to `SE_SESSION`, then `CLAUDE_SESSION_ID`, then the ledger session.

On success it prints "recorded a one-time override of <rule> on <file> by a person. It shows on
the receipt." and `{"overridden":true, ...row, "bundle": <dir>}`, exit 0.

On refusal it prints `override refused: <reason>.` on stderr and exits 1. The reasons are:
"no session id, so there is no rule stop to answer", "<file> is outside this project", "no rule
stop is recorded for this session", "this rule is enforced by your organization's settings",
"another paqad gate also stopped this edit, so it cannot be allowed once", "the last rule stop
was for a different rule or file", "the last rule stop was for a different
tool call", "the override token is missing, wrong or already used" and "no active change to
record the override in".

## Library surface

- `applyRuleOverride(request): RuleOverrideOutcome` and
  `managedSettingsEnforcePaqad(paths)` in `src/rule-scripts/override.ts`.
- `writeRuleStopRecord`, `readRuleStopRecord`, `markRuleStopTokenUsed` in `src/hud/last-block.ts`.
- `appendRuleOverride`, `readRuleOverrides` in `src/feature-evidence/rule-overrides.ts`.
