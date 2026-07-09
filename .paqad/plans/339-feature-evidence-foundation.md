# Plan — Issue #339 Phase 1: Per-feature evidence bundle foundation (dark)

## Scope

Issue #339 is a 7-phase epic ("one git-linked directory per feature"). Its own
Solution Direction sequences the phases as independently shippable PRs. This PR
delivers **Phase 1 — Foundation (dark)** only: new, additive modules with **zero
behaviour change**, so the live feature-development stage spine cannot break.

Deferred to later PRs (explicitly out of scope here): re-keying the live
stage-evidence recorder/gate (Phase 2), plan/spec compile (Phase 3), re-homing
the rule/delivery/receipt/AI-BOM/RAG ledgers (Phase 4), native git hooks
(Phase 5), on-demand projections (Phase 6), cutover/cleanup (Phase 7).

## What Phase 1 builds

A new `src/feature-evidence/` module, wired to nothing:

1. **Path layer** (`paths.ts`) — resolves the per-feature directory
   `.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/`, the `_session`
   control path, and the `_chat` home. Parses a dir name back into
   `{ issue, slug, ulid }`. Reuses `PATHS` constants.
2. **Dir-name mint** (`mint.ts`) — mints a feature dir name from a title +
   optional issue ref, reusing `deriveSlug` (slug-utils), `detectTicketRefs`
   (ticket-ref-detect), and `ulid()` (core/ids). The dir name **is** the change
   key, immutable once born.
3. **Rigid schemas** (`schema.ts` + `types.ts`) — framework-owned AJV schemas for
   `feature.json` and `plan.json`, mirroring `src/stage-evidence/schema.ts`
   (additionalProperties:false, unknown keys rejected). `specification.json`
   reuses the existing `FeatureSpec` shape (no new spec logic). Builders stamp a
   SHA-256 `content_hash` over identity fields (volatile timestamps excluded),
   reusing the session-ledger hashing approach.
4. **Session control** (`session-control.ts`) — the `_session/<sessionId>.json`
   store: `{ active, paused[], lane }`. Active + paused feature stack with
   set-active (pauses the prior active), resume (pop a paused feature), set-lane,
   mark-done. Folds today's `.open` + `.pending-lane` role at feature grain.

## Constraints honoured

- **No wiring** into the live recorder, capability gate, workflow-state, or CLI.
  Phase 1 is dark, so feature-development stages are untouched.
- **Rigid, script-owned JSON**: schemas reject unknown keys; builders own the
  bytes; the model never hand-writes a stored file.
- `pnpm run ci` green, including the repo 95% coverage floor (new module fully
  unit-tested).
- Changeset added (`paqad-ai` minor — additive foundation).

## Steps

1. Add `FEATURE_EVIDENCE_DIR` / `FEATURE_EVIDENCE_SESSION_DIR` / `CHAT_LEDGER_DIR`
   to `paths.ts`.
2. `src/feature-evidence/types.ts` — `FeatureRecord`, `PlanRecord`, `FeatureStatus`.
3. `src/feature-evidence/paths.ts` — dir resolvers + name parse.
4. `src/feature-evidence/mint.ts` — dir-name mint + record builders (content_hash).
5. `src/feature-evidence/schema.ts` — AJV validators for feature/plan.
6. `src/feature-evidence/session-control.ts` — session control store.
7. `src/feature-evidence/index.ts` — barrel.
8. Unit tests for each; changeset; full CI.
