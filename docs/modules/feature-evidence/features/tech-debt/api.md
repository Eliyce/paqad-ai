# Tech Debt: API View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `tech-debt`

Every subcommand takes `--project-root <path>` (default the current folder) and
`--session <id>` (default `SE_SESSION`, then `CLAUDE_SESSION_ID`).

## `paqad-ai debt add`

```text
paqad-ai debt add --title <text> --kind <bug|debt|gap|follow-up> --severity <low|medium|high>
                  [--file <path>]... [--body-file <md>] [--agent <name>]
```

Prints one `▸ paqad` line ("recorded TD-... as tech debt", "TD-... already records this
finding; nothing written" or "reopened TD-...; the same finding came back"), then
`{"id","outcome","path"}` where `outcome` is `created`, `existing` or `reopened`.

## `paqad-ai debt list`

```text
paqad-ai debt list [--status <open|promoted|closed|all>] [--change <current|ULID>] [--format <text|json>]
```

Defaults: `--status open`, `--format text`. Text prints one line per item,
`TD-...  <status>  (<kind>, <severity>)  <title>`, or `No tech-debt items match.`. `--change
current` uses the active change and fails when there is none.

## `paqad-ai debt promote <id> --issue <ref>`

Sets `status: promoted` and `issue`. Prints `{"id","status","issue"}`.

## `paqad-ai debt close <id> --reason <why>`

Sets `status: closed` and `closed_reason`. Prints `{"id","status","closed_reason"}`.

## Exit codes

`0` on success, `1` with the reason on stderr for any invalid value, empty text, unknown id or a
file outside the project.

## Library surface

- `raiseTechDebt(projectRoot, input, now, bundle)`, `promoteTechDebt(...)`,
  `closeTechDebt(...)` in `src/tech-debt/index.ts`.
- `listDebtItems(projectRoot, { status?, change? })`, `readDebtItems(projectRoot)` in
  `src/tech-debt/items.ts`.
- `renderTechDebtPrSection(items)` in `src/tech-debt/pr-section.ts`.
- `writeFeatureTechDebtIndex(projectRoot, dirName)` in `src/feature-evidence/tech-debt-index.ts`.
