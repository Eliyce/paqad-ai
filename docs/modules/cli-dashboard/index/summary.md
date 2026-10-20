# Project Dashboard & Status Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-dashboard`

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

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/dashboard/`.

- **Mutations (`approvals.ts`, `ops-jobs.ts`, `packs-config.ts`, `config-*.ts`).** Every
  mutation goes through the same store or core function the agent and the CLI use, and adds an
  `actor="dashboard"` audit line, so a web action is indistinguishable from a CLI one. A module
  decision accepted here is only a state change; the map edit is still applied on the agent's
  next run. Ops jobs are in-memory, one running job per action, and the heavy flows (`update`,
  `refresh-stack`, `regenerate-registries`) are deliberately left out. A job error sends only its
  first line to the browser. A pack name is checked against a safe pattern before any path is
  built from it. Placeholder design tokens are an expected state, and a failure to regenerate the
  derived docs is reported, never thrown, so it cannot mask a successful save.
- **`write-pipeline.ts`.** Every file write checks the allowlist (`docs/instructions/**` plus the
  named config files, checked before the dotfile rule because those names start with a dot),
  compares a content hash for concurrent edits, writes through a temp file and rename, and audits.
  The root is canonicalized (macOS tmpdir sits behind `/var` to `/private` symlinks) and a
  symlinked target or parent that escapes the root is rejected. No agent sync code is needed: a
  write under `docs/instructions/` already invalidates the agent-entry sentinel.
- **`config-profile.ts` and `config-rag.ts`.** The canonical form is validated, so a legacy shaped
  payload cannot bypass the schema. Framework knobs are synced to `.paqad/.config`, and the RAG
  write is scoped to the intelligence section so other `.config` keys are never touched. The RAG
  write iterates a static key list, never client-sent names. A RAG status read never creates an
  embedding provider, so a GET never touches the network.
- **`config-module-map.ts`.** A map the reconciler would coerce into an empty identifier is
  rejected, so the dashboard never saves a map whose findings cannot be attributed.
- **`collectors/project-profile.ts`.** It parses the YAML itself instead of calling
  `readProjectProfile`, which can rewrite a legacy file, breaking the read-only contract. MCP
  servers are only recommendations; paqad configures none, so the card never says it did.
- **Collectors reading evidence.** Decisions and delivery are read from the session ledger, not by
  scanning folders; the folders stay as the gate's working copy and are written together.
  Receipts, evidence, the AI-BOM, rule findings and the onboarding checklist's first gate are read
  from the union of the per-feature bundles. Rule drift stays in the reconciler's cache, because
  drift describes the project, not a change. Packs and patterns are read from `~/.paqad/` first,
  with the older `~/.paqad-ai/` as a fallback. A proposed module decision past its TTL counts as
  expired even before the sweep runs. The module-health stale flag uses the same 14-day window as
  the rollup.
- **`architecture.ts`.** The chunk index can be several megabytes, so it is scored on existence,
  size and freshness only, never parsed on each refresh.
- **`server.ts`.** Every mutation requires an onboarded project, is refused in `--read-only` mode,
  needs a loopback Host header (DNS rebinding guard) and, when a browser sends one, a same-origin
  Origin; `Origin: null` counts as foreign. A layout written by a newer paqad is refused with a
  409 instead of being overwritten. A stale hash returns a 409 with the current content for a
  side-by-side diff. Only the first line of a known error crosses the boundary. The resolve route
  accepts both `D-<ULID>` and the older numeric `D-<n>` ids. The graph API is mounted outside the
  mutation guard so a write to it falls through to 404, and extraction runs on the first request,
  never at boot. The SIEM download is byte-identical to `paqad-ai audit export`, and a non-empty
  export ends in a newline.
- **`trust.ts`, `export-packet.ts`, `snapshot.ts`.** Evidence is read-only by design. With no
  whole-project chain, each receipt card is verified on its own; a newer receipt is sealed only
  while the `evidence.jsonl` lines it covers still hash to its `evidence_sha256`. Exports and
  snapshots are self-contained HTML (inline styles, no scripts) so they render with the server
  stopped. A skipped gate is grey, never the amber "needs a look".

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
