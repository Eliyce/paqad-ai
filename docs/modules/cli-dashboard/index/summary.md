# Project Dashboard & Status Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-dashboard` &nbsp;·&nbsp; **Issue:** #146

## Purpose

Answer one question without making the user dig through `.paqad/`: **"where am I
on this project?"** `paqad-ai dashboard` is the living single-pane web view of
everything the framework knows — health, drift, approvals, trust, automation —
and `paqad-ai status` is the same data as a one-shot, LLM-friendly snapshot for a
terminal or an agent. Both read from one report builder, so the web view and the
printed report can never disagree.

## Commands

```
paqad-ai dashboard [--port <n>] [--host <addr>] [--no-open] [--no-watch] [--read-only] [--quiet]
paqad-ai status [--json]
```

| Flag (`dashboard`) | Default | Meaning |
| --- | --- | --- |
| `--port` | `4317` | Server port; auto-increments if occupied. |
| `--host` | `127.0.0.1` | Bind address (local-first by default). |
| `--no-open` | open | Do not launch the browser automatically. |
| `--no-watch` | watch | Disable live reload on `.paqad/` changes. |
| `--read-only` | off | Disable **every** mutation endpoint — for shared or CI usage. |
| `--quiet` | off | Suppress non-essential stdout. |

`status` prints the same report as Markdown (default) or `--json` for piping
into an agent or another tool.

## The management rule (load-bearing)

The dashboard is allowed to be a control surface only within one boundary, and
every endpoint is built to respect it:

- **The web edits settings and content** — delivery policy, instruction files,
  RAG config, design tokens, the decision contract, the module map. These go
  through the audited write pipeline (allowlist → hash guard → atomic write →
  audit row).
- **The prompt does the work** — running a workflow, generating module docs, or
  executing a verification pass stays an agent action. The web never silently
  runs the agent's job.
- **Evidence is view-only** — the Trust area (evidence timeline, DSSE receipt
  cards, AI-BOM) is read and export, never edit. Provenance you can rewrite is
  not provenance.

`--read-only` collapses all three to read so the dashboard is safe to expose on
a shared box or in CI.

## Seven-area IA

The view is organised as **Pulse · Approvals · Trust · Build · Automation ·
Knowledge · Setup**, with a comprehension layer over the raw data — ownership
badges (who edits this: web / prompt / evidence), one-line "why" sentences, why
drawers, and honest empty states. Scoring in phase 1 is **existence + freshness
only** — no content-quality heuristics. The graph view is one section inside the
dashboard, reached through the shared `graph-ui` bundle via a hash router.

## Source Footprint

- `src/cli/commands/dashboard.ts` — the HTTP + SSE server launcher.
- `src/cli/commands/status.ts` — the one-shot Markdown / JSON printer.
- `src/dashboard/report.ts`, `src/dashboard/types.ts` — the single report builder
  every surface reads.
- `src/dashboard/collectors/**` — per-section collectors (health, drift,
  approvals, trust, module map, rules, workflows, …).
- `src/dashboard/scoring/**` — freshness / presence / band primitives.
- `src/dashboard/approvals.ts`, `trust.ts`, `inventory.ts` — the approvals inbox,
  the read-only trust area, and the web/prompt/evidence classification.
- `src/dashboard/write-pipeline.ts` and the `config-*.ts` editors — the audited
  mutation path behind the web editors.
- `graph-ui/src/views/**`, `graph-ui/src/components/**` — the React 19 frontend
  (Pulse, Approvals, Trust, Area views + section components).

## Boundaries

This module **owns** projecting `.paqad/` state into a report and serving it, plus
the audited config-write path. It does **not** own the underlying engines
(verification, evidence, module map, delivery) — it reads their on-disk output and
writes back only the settings/content they accept. It does not run the agent's
work and does not mutate evidence.

## Authority

The single source of truth for this module's identity, slug, feature names, and
source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins** — update the map first,
then regenerate this page via `create module documentation`.

## Related

- Evidence ledger + receipts (the Trust area's data): [`evidence-ledger`](../../evidence-ledger/index/summary.md)
- SIEM export of the same ledger: [`cli-audit`](../../cli-audit/index/summary.md)
- Project graph (shares the `graph-ui` bundle): [`cli-graph`](../../cli-graph/index/summary.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
