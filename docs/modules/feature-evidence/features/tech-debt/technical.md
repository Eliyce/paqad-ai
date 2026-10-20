# Tech Debt: Technical View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `tech-debt`

## Module Boundaries

- `src/tech-debt/items.ts`: the item store. Ids, parse and serialize, add, promote, close, list.
- `src/tech-debt/index.ts`: the entry points the CLI calls; each write also refreshes the overview
  block and the active change's `tech-debt.json`.
- `src/tech-debt/overview-block.ts`: renders the open-items block and splices it into the overview.
- `src/tech-debt/context.ts`: resolves the active change, issue and running stage for `found_in`.
- `src/tech-debt/pr-section.ts`: the "Tech debt found in this change" PR section.
- `src/feature-evidence/tech-debt-index.ts`: the per-change `tech-debt.json` bundle file.
- `src/core/text/marker-block.ts`: replaces the text between two markers, shared with other
  generated blocks.
- `src/cli/commands/debt.ts`: `paqad-ai debt add|list|promote|close`.

## Data Model

Each item is `docs/instructions/tech-debt/TD-<ULID>.md`: YAML front matter, then a `## What`
heading and the markdown body from `--body-file`.

| Field | Meaning |
| --- | --- |
| `id` | `TD-<ULID>` |
| `title` | one line |
| `kind` | `bug`, `debt`, `gap` or `follow-up` |
| `severity` | `low`, `medium` or `high` |
| `status` | `open`, `promoted` or `closed` |
| `files` | project-relative paths, sorted, unique |
| `found_in` | `{ change, issue, stage }` of the active change, each `null` when there is none |
| `found_by` | the agent that found it, default `orchestrator` |
| `session` | the session id |
| `created_at`, `reopened_at` | ISO times |
| `issue` | set by `promote` |
| `closed_reason` | set by `close` |

The bundle's `tech-debt.json` holds `items: [{ id, title, kind, severity }]` for the items whose
`found_in.change` is that change, sorted by id.

## Behaviour

- **Dedupe.** The key is the title lowercased with spaces collapsed, plus the sorted file list. A
  match that is open or promoted returns `existing` and writes nothing; a closed match is set back
  to `open` with `reopened_at` and returns `reopened`.
- **Overview block.** `docs/instructions/tech-debt/overview.md` (or `index.md` when that is the
  file present) carries `<!-- paqad:tech-debt:start -->` and `<!-- paqad:tech-debt:end -->`.
  Between them paqad writes one line per open item, newest first:
  `- [TD-<ULID>](TD-<ULID>.md) (<kind>, <severity>): <title>`. With no markers yet the block is
  appended; the line endings of the file are kept.
- **Receipt, HUD and PR.** The receipt and the HUD read the bundle's `tech-debt.json`; the PR body
  adds the section from `renderTechDebtPrSection` only when the change raised items.
- **Review triage.** A review finding may carry `deferred_to: TD-<ULID>`; the triage classifier
  routes a confirmed out-of-scope finding to `debt add`.
- **Entry sentinel.** The agent-entry staleness walk skips `docs/instructions/tech-debt/`, so
  recording debt never forces the agent to reload the framework.

## Error Handling

`TechDebtError` carries the user-facing message; the CLI prints it and sets exit code 1.
