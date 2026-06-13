# Dashboard one-stop-shop: fold the graph and the SIEM export into the dashboard

Status: ready to implement
Follows: [unified-management-dashboard.md](unified-management-dashboard.md) (issue #146), SIEM export (issue #121)
Type: no new product surfaces, consolidation and polish only

## 0. North star

The dashboard (`paqad-ai dashboard`) is the one place a person opens to understand and operate a paqad-onboarded project. Today two flagship pieces live outside it: the project **graph** has its own command (`paqad-ai graph`), and the **SIEM export** is CLI only (`paqad-ai audit export`). This work pulls both inside the dashboard so there is one front door, then adds two consolidation features (saved views, shareable snapshots) that make a multi-feature dashboard stay usable instead of sprawling.

The bar, as before: a person should be able to admire it and want to share it.

## 1. The problem we are solving

- Two front doors for the graph. `paqad-ai graph` and `paqad-ai dashboard` serve the same SPA bundle, but the **graph route only works under the `graph` command's server**. The dashboard server does not serve the graph API at all (`src/dashboard/server.ts` has `/api/audit` and `/api/export/evidence-packet` but no `/api/graph`). So the graph is reachable from the dashboard URL only in theory; in practice it breaks. That split is the root of the "two commands" confusion.
- The SIEM export is invisible from the dashboard. A person looking at the Trust page sees the evidence ledger and receipts, can export an evidence *packet* (HTML/Markdown), but cannot do the thing #121 shipped: project that ledger into OCSF/ECS/CEF/JSONL for their own SIEM. They have to know a CLI command exists.
- A dashboard that keeps growing needs a way to not sprawl. Adding pieces without saved scopes and shareable output turns a one-stop shop into a junk drawer.

## 2. Decisions locked

| Decision | Choice | Rationale |
| --- | --- | --- |
| Graph placement | **Own top-level nav area** (8th area, peer to Pulse/Trust) | The graph is a flagship capability and a full-bleed exploratory destination, not a sub-page. NN/g: a persistent left rail is not bound by "7 plus or minus 2"; add an area when it aids findability. |
| Export placement | **Utility panel inside Trust**, attached to the ledger it acts on | Export is a utility action, not a destination. Matches Vanta / Drata / AWS Security Hub patterns: the export control sits next to the evidence it projects. Keeps the nav unchanged. |
| Extra consolidation features | **Saved views/filters** and **shareable snapshots** | Both have direct precedent (Datadog saved views; Datadog/Geckoboard snapshots) and both fight sprawl: saved scopes reduce re-filtering, snapshots make output shareable without granting app access. |
| Command palette (Cmd-K) | Already shipped (`graph-ui/src/components/CommandPalette.tsx`, rendered in `DashboardChrome`) | No work. It is the canonical antidote to feature growth and we already have it; wire the new destinations into it (see 4.2, 8). |

### Why these choices are validated (problem validation)

- Glanceability and overview-first. A dashboard must answer at a glance; exploratory things (a graph) belong behind a drill-down, not on the home screen (NN/g, "Dashboards: Making Charts and Graphs Easier to Understand", https://www.nngroup.com/articles/dashboards-preattentive/; Shneiderman, "overview first, zoom and filter, details on demand", https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf). Pulse stays the glance; Graph is its own canvas.
- Single pane of glass helps only when it is objective-driven and task-scoped, not "everything on one screen" (SigNoz, https://signoz.io/blog/single-pane-of-glass-monitoring/; "The myth of the single pane of glass", https://www.betsol.com/blog/the-myth-of-the-single-pane-of-glass/). We fold features in as scoped destinations and actions, not as new always-on panels.
- Lean core, modular capabilities. Backstage keeps a minimal spine (catalog, create, docs) and pushes everything else into plugins so the portal never balloons (https://backstage.io/docs/overview/background/). Our 7 areas are the spine; the graph earns an area, the export stays an action inside Trust.
- Local vs utility navigation. Utility actions should be discoverable, not prominent, and live in a section toolbar, not the primary nav (NN/g, https://www.nngroup.com/articles/universal-navigation/). That is exactly the export.
- Graph viz UX. A network graph is exploratory: full-bleed canvas, filter-first, details-on-demand, collapsible chrome over the canvas (Cambridge Intelligence, "10 rules of great graph design", https://cambridge-intelligence.com/10-rules-great-graph-design/). Our `GraphView` already follows this; we keep it.
- SIEM export UX. Offer explicit format choice (OCSF default), scope filters (date range), a redaction toggle, and one-shot download, attached to the audit view (AWS Security Hub OCSF export, https://aws.amazon.com/blogs/security/export-historical-security-hub-findings-to-an-s3-bucket-to-enable-complex-analytics/; Datadog OCSF, https://www.datadoghq.com/blog/ocsf-common-data-model/; Drata scoped sampling, https://help.drata.com/en/articles/9083978-download-audit-evidence-from-audit-hub).

## 3. Scope and non-goals

In scope:
1. Serve the full graph API from the dashboard server.
2. Add Graph as a top-level dashboard area; render it inside the dashboard chrome.
3. Remove the `paqad-ai graph` command (keep all graph functionality).
4. Add a "Export to your SIEM" utility panel in Trust, backed by a new dashboard endpoint.
5. Saved views/filters, project-scoped.
6. Shareable, access-free snapshots of a receipt or a module-health card.

Out of scope (defer to follow-ups):
- Scheduled Slack/email digests (push delivery). Noted as a strong next step but not in this cut.
- The `--hec` push transport for SIEM export (already deferred in #121).
- Editing evidence (it is view-and-export only, by design).

## 4. Feature 1: Graph as a top-level dashboard area

### 4.1 Server: the dashboard must serve the graph API

The dashboard server (`src/dashboard/server.ts`) currently serves no graph endpoints. Port the read-only graph API from `src/graph/server.ts` (routes at lines 267 to 356) so the dashboard is the sole host:

| Method + path | Source to reuse | Purpose |
| --- | --- | --- |
| `GET /api/graph` | `extractGraphWithSidecar()` warm-loaded | full nodes/edges/meta payload |
| `GET /api/node/:id` | graph node lookup | node detail + chunk content |
| `GET /api/chunk/:id/content` | chunk reader | chunk text snippet |
| `POST /api/similar` | `SimilarityResolver` over `.paqad/vectors/` | similarity edges by threshold/scope |
| `GET /api/events` (existing) | add a `graph-updated` event to the existing `.paqad/` watcher | live reload |

Implementation note: factor the graph request handling in `src/graph/server.ts` into a reusable `createGraphRoutes(projectRoot)` module under `src/graph/`, then mount it from both the (about-to-be-removed) graph server and the dashboard server. After the graph command is removed (4.3), only the dashboard mounts it. The graph API stays strictly read-only: do not route it through the dashboard mutation guard.

The dashboard already watches `.paqad/` and broadcasts `dashboard-updated` over `/api/events`. Add `graph-updated` emission on the same watcher so `GraphView`'s existing listener (`graph-ui/src/views/GraphView.tsx:55`) keeps working unchanged.

### 4.2 SPA: surface Graph in the chrome

The route already exists (`graph-ui/src/lib/router.ts`) and `App.tsx:23` already renders `GraphView` for `route === 'graph'`. Two precise changes:

1. Add `graph` to the nav. In `graph-ui/src/lib/dashboard-types.ts`, extend `DashboardArea` with `'graph'`. In `DashboardChrome.tsx`:
   - add a `graph` entry to the `NavIcon` `paths` map (suggested glyph, a small node-link: `<path d="M4 4h3v3H4zM9 9h3v3H9zM7 5.5h2.5M5.5 7v2" />`),
   - add `{navItem('graph', 'Graph')}` to the `<nav>` block, placed after `build` (Graph reads as "look at the codebase", so it sits next to Build),
   - add `graph` to `PAGE_WHY` in `copy.ts` (microcopy in section 9).
2. Wrap `GraphView` in the chrome. Today `App.tsx` returns `<GraphView />` bare ("full-bleed", no chrome) while every other view wraps `DashboardChrome` internally. Make `GraphView` consistent: import `DashboardChrome` and render the existing graph container as its `children`. Because the graph's own control panel is already an absolutely-positioned floating panel (`Sidebar.tsx`, `absolute left-3 top-3`), once it renders inside the chrome's `<main>` content column it floats at the left of the canvas area, not over the nav rail. No overlap. Polish while there: make that floating panel collapsible, and drop its theme toggle (the chrome footer already owns theme), so there is one theme control, not two.

Result: clicking Graph in the left rail shows the full graph canvas in the content area, with the same chrome, theme, and live indicator as every other page.

### 4.3 Remove the `paqad-ai graph` command (keep the functionality)

- Delete the command registration from `src/cli/program.ts` and remove `src/cli/commands/graph.ts`.
- Keep all graph internals (`src/graph/extract*`, similarity, types, the shared `createGraphRoutes` from 4.1). Only the standalone command and its server entrypoint go away.
- Muscle-memory shim (recommended, one minor version): keep `graph` as a hidden, deprecated alias that prints the deprecation line (section 9) and launches `paqad-ai dashboard` opening on `#/graph`, then remove it in the next minor. If you prefer a hard cut, remove it outright; the deprecation line should then appear in the changeset and README.
- Update README and any docs that mention `paqad-ai graph` to point at the dashboard Graph area. Update `docs/instructions/design-system/overview.md` (it says the SPA is "used for visualizing project graphs"; it is now the full dashboard).

### 4.4 Acceptance criteria

- `paqad-ai dashboard` then clicking Graph renders the live graph with working layer toggles, similarity, node detail, and live reload on `.paqad/` change.
- `paqad-ai graph` either no longer exists, or prints the deprecation line and opens the dashboard on the Graph view.
- No second theme control; no panel overlapping the nav rail.
- The graph API on the dashboard server is read-only (a forced mutation to a graph path is rejected, not silently allowed).

## 5. Feature 2: SIEM export as a utility panel in Trust

### 5.1 Server: one new read-only endpoint

Add to `src/dashboard/server.ts`, beside the existing `/api/export/evidence-packet`:

```
GET /api/export/siem?format=ocsf|ecs|cef|jsonl&since=<iso>&redact=true|false
```

It calls `exportAuditEvents(projectRoot, { format, since?, redact?, productVersion })` from `src/audit/export.ts` (pure, already shipped) and returns the serialized output with a download disposition:

- `Content-Type`: `application/json` for jsonl, `application/x-ndjson` for ocsf/ecs (one JSON object per line), `text/plain` for cef.
- `Content-Disposition: attachment; filename="paqad-siem-<format>-<yyyymmdd>.<ext>"` where ext is `jsonl`/`json`/`log` as appropriate. Note: filenames must stay posix-safe and must not contain `:` (Windows-illegal), so use `yyyymmdd`, not an ISO instant, in the filename.
- Read-only: this endpoint never writes and is not subject to the mutation guard. Default `format=ocsf`. Validate `format` against `SIEM_FORMATS` and 400 on anything else.

The CLI `paqad-ai audit export` stays exactly as is; this endpoint is an additional caller of the same pure function.

### 5.2 SPA: the export panel

In `graph-ui/src/views/TrustView.tsx`, add an "Export to your SIEM" panel directly under the existing evidence-packet export control (the `exportPacket` button at line 335). It is a small form, not a new page:

- Format: a segmented control or select. Options in order: `OCSF (recommended)`, `ECS`, `CEF`, `JSONL`. Default OCSF.
- From date: an optional date input mapped to `since` (ISO at start of day). Empty means the whole ledger.
- Redact names and free text: a toggle mapped to `redact`. Default off, with the helper line from section 9.
- Download export: a primary button that hits `GET /api/export/siem?...` and triggers a browser download. Show the resulting event count after download ("Exported 142 events.") using the `count` the endpoint can return in an `X-Paqad-Event-Count` header, or by reading the body length.

Keep it visually subordinate to the evidence timeline (it is a utility, per the IA rule). Reuse existing form atoms (`SchemaForm`/select styles) so it matches.

### 5.3 Acceptance criteria

- From Trust, a person can pick OCSF/ECS/CEF/JSONL, optionally set a from-date and redaction, and download a file that is byte-identical to what `paqad-ai audit export --format ... [--since ...] [--redact]` produces.
- Default format is OCSF; an invalid format query returns 400.
- The CLI command is unchanged and still works.

## 6. Feature 3: Saved views and filters (project-scoped)

A saved view captures a scope a person returns to: a graph filter (layers + similarity threshold + overlay), a Trust verdict filter, or a SIEM export config (format + since + redact). Project-scoped so a team shares them through git.

- Storage: `.paqad/dashboard/saved-views.json`, an array of `{ id, name, area, scope, createdAt }` where `area` is one of `graph | trust | export` and `scope` is the area-specific filter object.
- API: `GET /api/saved-views`, `PUT /api/saved-views/:id`, `DELETE /api/saved-views/:id`, all through the existing dashboard write pipeline and guard (loopback, same-origin, not read-only, onboarded). Writes broadcast `dashboard-updated`.
- UI: a small "Save this view" affordance in the Graph control panel, the Trust filter row, and the export panel; a "Saved views" list to apply or delete. Applying a view sets the area's existing state (no new state model).
- Acceptance: save a graph filter, reload, apply it, and the layers/threshold/overlay restore exactly; the same for a Trust verdict filter and an export config.

## 7. Feature 4: Shareable snapshots (access-free)

Let a person share a single trust receipt or a module-health card as a self-contained artifact, without giving the recipient access to the running dashboard. Reuse the evidence-packet HTML infrastructure (`buildEvidencePacket` in `src/dashboard/export-packet.ts`) which already renders standalone HTML.

- API: `GET /api/snapshot/receipt/:hash` and `GET /api/snapshot/module/:id` return a single self-contained HTML document (inlined styles, no live calls, a generated-at stamp). Read-only.
- UI: a "Share snapshot" action on each `ReceiptCardView` in Trust and on the module-health card in Build. It opens the snapshot in a new tab and offers "Download HTML". Optionally it writes to `.paqad/dashboard/snapshots/<kind>-<id>-<yyyymmdd>.html` so the file can be attached to a PR or ticket (posix-safe name, no `:`).
- Acceptance: opening a snapshot with the dashboard server stopped still renders the receipt/module correctly (it is fully static).

## 8. Information architecture after this work

Left rail, in order: **Pulse, Approvals, Trust, Build, Graph, Automation, Knowledge, Setup** (8 areas; Graph added after Build). Sub-pages still highlight their parent (delivery-policy under Automation, instructions/design-tokens under Knowledge, module-map under Build). The Cmd-K command palette gains three commands: "Open Graph", "Export to your SIEM", "Apply saved view". Export and snapshots are utility actions inside Trust/Build, not nav items.

## 9. Microcopy pack (use verbatim, no em dashes)

- Graph nav label: `Graph`
- Graph nav tooltip (`PAGE_WHY.graph`): `Your codebase as a living map: modules, files, and how they connect.`
- Graph command deprecation line: `paqad-ai graph has moved into the dashboard. Opening the dashboard on the Graph view. Run paqad-ai dashboard next time.`
- Export panel heading: `Export to your SIEM`
- Export panel subtext: `Project the evidence ledger into the schema your SIEM already ingests. Nothing leaves your machine until you download it.`
- Format label: `Format`
- From-date label: `From date (optional)`
- Redact toggle label: `Redact names and free text`
- Redact helper: `Strips human identities and free-text detail. Use this when you are sharing the export outside your team.`
- Download button: `Download export`
- Post-download confirmation: `Exported {count} events.`
- Save view affordance: `Save this view`
- Saved views list heading: `Saved views`
- Share affordance: `Share snapshot`
- Snapshot footer stamp: `Snapshot generated {date}. Static copy, no live data.`

## 10. Build plan

1. Server graph routes: factor `createGraphRoutes`, mount on dashboard, add `graph-updated` to the watcher. Verify the Graph area loads live.
2. Nav + chrome: extend `DashboardArea`, add icon/nav item/tooltip, wrap `GraphView` in `DashboardChrome`, collapse the floating panel, drop its theme toggle.
3. Remove `paqad-ai graph` (with or without the deprecation shim), update README and design-system overview.
4. SIEM export endpoint + Trust panel.
5. Saved views (storage, API, three apply points).
6. Shareable snapshots (two endpoints, two share actions).

Steps 1 to 4 deliver the core "one-stop shop" ask and can ship together; 5 and 6 can be a second PR.

## 11. Success metrics

- Zero references to `paqad-ai graph` as a separate command in docs and help output.
- The graph, the SIEM export, saved scopes, and shareable proof are all reachable from `paqad-ai dashboard` without touching the CLI.
- Graph loads inside the chrome with one theme control and no nav overlap.
- A downloaded SIEM export is byte-identical to the CLI's output for the same flags.

## 12. Risks and open questions

- Removing `paqad-ai graph` outright breaks muscle memory and any scripts that call it. The deprecation shim (4.3) mitigates this; confirm whether a hard cut is acceptable for this release.
- Warm-loading the graph on the dashboard server adds startup cost to `paqad-ai dashboard` even for people who never open Graph. Mitigation: lazy-load the graph extraction on first `/api/graph` hit rather than at boot.
- Saved views committed to `.paqad/` are shared through git, which is the intent, but means a noisy diff if people save many ad-hoc views. Consider a per-user `localStorage` tier later if that becomes a problem.

## Appendix: file change map

| File | Change |
| --- | --- |
| `src/graph/server.ts` | extract `createGraphRoutes(projectRoot)` |
| `src/dashboard/server.ts` | mount graph routes (read-only); add `graph-updated` to watcher; add `GET /api/export/siem`; add saved-views and snapshot endpoints |
| `src/cli/program.ts` | remove `graph` registration (or register hidden deprecated alias) |
| `src/cli/commands/graph.ts` | delete (or reduce to the deprecation shim) |
| `src/audit/export.ts` | no change (reused by the new endpoint) |
| `src/dashboard/export-packet.ts` | reuse for snapshots |
| `graph-ui/src/lib/dashboard-types.ts` | add `'graph'` to `DashboardArea` |
| `graph-ui/src/components/DashboardChrome.tsx` | graph icon, nav item, command-palette entries |
| `graph-ui/src/lib/copy.ts` | `PAGE_WHY.graph` |
| `graph-ui/src/views/GraphView.tsx` | wrap in `DashboardChrome`; collapsible panel |
| `graph-ui/src/components/Sidebar.tsx` | remove theme toggle; make collapsible |
| `graph-ui/src/views/TrustView.tsx` | SIEM export panel; share-snapshot action |
| `graph-ui/src/views/AreaView.tsx` (Build) | share-snapshot on module-health card |
| `README.md`, `docs/instructions/design-system/overview.md` | drop `paqad-ai graph`, describe the dashboard Graph area |
