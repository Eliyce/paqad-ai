# Dashboard — the full management surface (issue #146, phases 3-4)

**Status:** in progress. Successor to
[`dashboard-approvals-trust.md`](./dashboard-approvals-trust.md), which shipped
phases 1-2 (approvals inbox, trust area) and deliberately deferred the editing
surface. This document records the decision to build the deferred scope and the
architecture it follows.

## Scope decision

Phases 1-2 cut the editing surface after market research suggested local web
UIs are proven for viewing and approving but not for config editing. Issue
#146 keeps the full management surface as its contract, and the product
direction is now to complete it: every section-3A functionality editable on
the web, the full 7-area information architecture, the comprehension layer,
and onboarding. The risk the earlier cut responded to is mitigated by the
write pipeline below: the web edits the same files through the same core
functions the CLI uses, with the same audit trail, so config stays
file-shaped, diffable, and reviewable in git.

## The management rule (unchanged)

Web-managed settings are fully editable on the dashboard. Prompt-managed work
is visible as status and never editable. Evidence is view and export only.
`/api/inventory` is the one place this classification lives; every area page
and ownership badge renders from it.

## Information architecture

Seven areas behind a quiet left sidebar (collapsible to icons):
Pulse, Approvals, Trust, Build, Automation, Knowledge, Setup. The legacy
all-sections health view stays reachable at `#/dashboard`; the architecture
graph keeps `#/graph`, reached from Build.

Comprehension layer on every page: `OwnershipBadge` (You manage this / Paqad
manages this / Shared), `WhySentence` under every title, `WhyDrawer` (the
problem, what you get, what happens without it; hard cap of two disclosure
levels), `EmptyState` with the three slots, and the section-9 microcopy pack
applied verbatim (`graph-ui/src/lib/copy.ts`).

## Write pipeline (spec section 6.2)

Every PUT/POST funnels through `src/dashboard/write-pipeline.ts`:

1. **Validate** — ajv via the existing `SchemaValidator` for schema-backed
   files (delivery-policy, project-profile, design-tokens), YAML parse for
   YAML, frontmatter parse for instructions Markdown. Errors return
   field-level issues the UI renders inline.
2. **Write through core paths** — `writeManagedFile` enforces the path
   allowlist (only `docs/instructions/**` plus the named config files; no
   traversal, no dotfiles, symlinks resolved and rejected outside the root),
   checks the client's content hash (mismatch throws `WriteConflictError`,
   served as HTTP 409 with the current content for the diff prompt), and
   writes atomically. Endpoints that have a richer core function use it
   instead of raw content writes (see the map below).
3. **Audit** — every mutation appends `actor="dashboard"` plus the content
   hash to `.paqad/audit.log` via the existing `appendDashboardAudit`.
4. **Notify** — the server refreshes the report and broadcasts
   `dashboard-updated` over SSE immediately after every mutation.
5. **Agent sync** — needs no extra code: the agent-entry gates compare mtimes
   under `docs/instructions/**` against the sentinel, so the write itself
   invalidates stale agent context. The UI states this as the win line.

## Section-3A map: file → read path → write path

| Functionality | Read | Write | Validation |
|---|---|---|---|
| Canonical instructions | `listInstructionsTree` / `readInstructionsFile` (frontmatter parsed) | `writeManagedFile` | frontmatter/YAML parse, size cap |
| Workflow definitions | `WorkflowTemplateLoader` | `writeManagedFile` | YAML parse + engine shape |
| Delivery policy | `loadDeliveryPolicy` (the loader the pipeline uses) | raw YAML through `putDeliveryPolicy` | ajv `delivery-policy` |
| Module map | `readRawModuleMap` + `readDriftReport` | document-workflow map writer; reconcile as an op | shape checks + reconcile |
| Decision pause contract | managed file read | `writeManagedFile` | content guard |
| Project profile | `readProjectProfile` | `writeProjectProfile` | ajv `project-profile` |
| Capabilities | profile `active_capabilities` | `writeProjectProfile` | enum |
| Stack packs | `StackPackLoader` | pack install/remove core paths | ajv `stack-pack` |
| Provider adapters | adapter registry | `refreshProviderEntries` | adapter-specific |
| RAG configuration | `RagService.getStatus` | `RagService.configureAndBuild` / `clear` (ops jobs) | intelligence schema |
| Design tokens | `DesignTokenService.load` | token write + `writeDocs` / `writeThemeExports` | ajv `design-tokens` |
| Defect patterns | `PatternStore` | prune/export core paths | n/a |
| Decisions and approvals | shipped in phases 1-2 | shipped in phases 1-2 | state machines |

Safe operations (spec 3D) run as idempotent jobs over the same core functions
the CLI commands call, with progress streamed as `ops-progress` SSE events.

## Area-by-area design

**Pulse** is the home: the overall score as the one big number with a band
dot and a sentence from the top attention item, four stat cards (pending
approvals, healthy sections, sealed receipts, framework version), the
attention list capped at five with deep links, and the onboarding checklist
until it completes. The empty state for a never-onboarded project teaches
the first step.

**Approvals** and **Trust** are the phases 1-2 surfaces, unchanged in
behavior; both gain the page why-sentence. Trust adds the evidence packet
export (`/api/export/evidence-packet`, HTML / Markdown / JSON), a
self-contained bundle with the receipt chain, the timeline, and the AI-BOM
summary.

**Build** carries the module map editor (structured table for orientation, a
raw-YAML editor of record, drift findings inline with a one-click reconcile
job) plus the evidence cards for module health, events, stack snapshot,
compliance, quality baseline, pentest, and rule compliance. The architecture
graph stays one click away.

**Automation** carries the delivery policy rule builder (per-section
auto/manual toggles, typed fields, plain-language previews, raw YAML mode)
and the prompt-managed status cards for workflow runs, plans, specs, and the
session.

**Knowledge** carries the instructions editor (file tree, CodeMirror with
frontmatter as fields, markdown preview, the 409 diff prompt), the design
token editor (swatch grid, raw JSON, live preview, derived docs regenerated
on save), and the RAG panel (status, settings form, rebuild / clear /
refresh-context jobs with consequence confirmations).

**Setup** carries the profile schema form, the capability toggles with
per-capability why lines, pack install / remove with consequence
confirmations, and the doctor / refresh-rules / compliance-check operations.

Safe operations run through one in-memory job runner per server: same-action
starts conflict with 409, progress streams as `ops-progress` SSE events,
finishing jobs refresh the report and append their audit line.

## Delivery plan

Stacked, reviewable PRs: (A) comprehension layer, `/api/inventory`, 7-area IA
shell; (B) write pipeline plus the delivery-policy editor, proving the
pipeline end to end on the smallest schema; (C) the remaining editors and the
ops job runner; (D) Pulse content, command palette, onboarding checklist, and
polish. Guardrails from phases 1-2 (loopback host, same-origin, 64 KB cap,
`--read-only`, onboarded-only) apply to every new mutation unchanged.
