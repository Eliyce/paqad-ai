# Dashboard — Approvals inbox and Trust area (issue #146, scoped)

**Status:** shipped. Companion to [`dashboard-phase-1.md`](./dashboard-phase-1.md).

## Scope decision

Issue #146 proposes a full management dashboard: seven areas, web editors for
every config file, a command palette, a token editor. We shipped a deliberate
subset and recorded why, so the cut is a decision rather than an accident.

What the 2025-2026 market rewards in agent-governance tooling is
**see, approve, prove**:

- Human-in-the-loop approval surfaces are in demand (RedMonk's agentic-IDE
  wish list, EU AI Act Article 14 binding August 2026, the Agent
  Inbox/Omnara/Mission Control wave). The differentiator is fewer,
  higher-stakes approvals with consequence context, which is exactly what the
  decision-pause contract produces.
- Attestation and AI-BOM demand is rising while the tooling stays immature.
  Rendering receipts legibly and making them shareable is the gap.
- Local web UIs served by a CLI are a proven pattern for *viewing and
  inspecting* (Prisma Studio, Temporal UI, Mastra Studio). They are not a
  proven pattern for *config editing*: Vue CLI's `vue ui` died, and
  config-as-code practice deliberately routes changes through files, git, and
  review. A browser YAML editor would also work against paqad's own
  evidence-first story.

So: the approvals inbox and the trust area are in; the editing surface is out.
Config stays in files where the user's editor, git history, and the agent
already are.

## What shipped

Two new SPA routes on the existing dashboard (same bundle, same hash router,
same SSE stream), backed by new endpoints on the existing server:

```
GET  /api/decisions                          unified inbox feed (pauses + module proposals)
POST /api/decisions/{D-id}/resolve           { chosen_option_key, note? }
POST /api/module-decisions/{MD-id}/accept
POST /api/module-decisions/{MD-id}/reject

GET  /api/ledger/evidence?gate=&verdict=&limit=   evidence timeline, newest first
GET  /api/ledger/receipts                         DSSE receipt cards with per-link seal status
GET  /api/ledger/ai-bom                           persisted CycloneDX document
GET  /api/ledger/pr-comment?sha=                  the exact Markdown `paqad-ai evidence` prints
```

## Write pipeline

Every mutation goes through the stores the agent already uses, never through
re-implemented file logic:

1. Decision pauses resolve via `DecisionStore.resolve()` (same index, audit
   trail, supersede logic, lock). `responded_by` is `dashboard`, so a web
   resolution is indistinguishable, for the agent, from a CLI one.
2. Module proposals transition through the MD-XXXX state machine
   (`canTransition` enforced); accepting records `approved_by: dashboard` and
   appends the `module.declared` event. Applying the map mutation stays with
   the existing apply path, exactly as with CLI acceptance.
3. Every mutation appends `actor="dashboard"` to `.paqad/audit.log`.
4. After a mutation the server refreshes the report and broadcasts
   `dashboard-updated`, so every open client (badge included) updates without
   waiting for the watcher debounce.

## Guardrails

- Mutations require an onboarded project (`.paqad/onboarding-manifest.json`),
  else 409.
- `--read-only` (CLI flag → server option) turns every mutation into a 403,
  for shared or CI usage.
- Mutations require a loopback `Host` header (DNS-rebinding guard) and, when a
  browser sends `Origin`, it must match the host. Foreign origins get 403.
- JSON bodies are capped at 64 KB.
- The trust area has no mutation routes at all. Evidence is view and export
  only, because editable evidence is worthless.

## Deliberately deferred

- Web editing of instructions, workflows, delivery policy, profile, tokens.
  Read-only rendering with "open in editor" deep links is the likely next
  step if engagement proves out.
- Bulk actions in the inbox, evidence export packet, command palette,
  onboarding checklist (issue #146 phases 3-4).
