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

## `paqad-ai rules override --outcome`

```text
paqad-ai rules override --outcome <landed|refused|still-blocked> --rule <id> --file <path>
                        --tool-use-id <id> [--project-root <path>] [--session <id>]
```

The HUD runs this after it retried an allowed-once edit. `--token` is not needed. On success it
prints "recorded that the allowed-once edit of <file> landed" (or "was refused", or "stayed
blocked") and `{"outcome_recorded":true, ...row, "bundle": <dir>}`, exit 0.

On refusal it prints `outcome not recorded: <reason>.` on stderr, writes nothing and exits 1. The
reasons are: "no session id, so there is no override to follow", "<value> is not landed, refused
or still-blocked", "an outcome needs the tool call it follows", "<file> is outside this
project", "no active change to record the outcome in" and "no override for this tool call is
waiting for its outcome" (no override row for that tool call, rule and file, or an outcome row
for that tool call already).

## Library surface

- `applyRuleOverride(request): RuleOverrideOutcome`, `recordEditOutcome(request):
  EditOutcomeResult` and `managedSettingsEnforcePaqad(paths)` in `src/rule-scripts/override.ts`.
- `writeRuleStopRecord`, `readRuleStopRecord`, `markRuleStopAllowedOnce`, `takeAllowedOnce` in
  `src/hud/last-block.ts`.
- `appendRuleOverride`, `readRuleOverrides`, `appendRuleOverrideOutcome`,
  `overrideAwaitsOutcome` in `src/feature-evidence/rule-overrides.ts`.
- `ALLOW_ONCE_REASON` and `CapabilityGateResult.ask` in `src/kernel/gate.ts`.
- `preToolUseAsk(result, seam, adapter)` in `runtime/hooks/capability-gate.mjs`.
