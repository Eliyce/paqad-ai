---
'paqad-ai': minor
---

Per-feature evidence bundle — Phase 1 foundation (dark) (#339).

Lay the additive, unwired foundation for the "one git-linked directory per feature"
model: each feature will get one directory
`.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/` holding its whole workflow
record plus its compliance bundle. This phase ships the plumbing only — no behaviour
change, so the live feature-development stage spine is untouched.

- New `src/feature-evidence/` module: a path layer that resolves the per-feature
  directory, the `_session` control, and the `_chat` home and round-trips a dir name to
  its `{ issue, slug, ulid }` parts (reusing `deriveSlug` / `detectTicketRefs` / `ulid`).
- Rigid, framework-owned AJV schemas for `feature.json` and `plan.json`
  (`additionalProperties: false`) with record builders that stamp a deterministic
  SHA-256 `content_hash`, so the stored bytes are script-owned rather than a
  free-written hallucination surface. `specification.json` reuses the existing
  `FeatureSpec` shape.
- A per-session control (`_session/<sessionId>.json`) holding one active feature plus a
  paused-feature stack and the pending lane, folding today's `.open` + `.pending-lane`
  role at feature grain.

Nothing writes to these paths yet; wiring the recorder, plan/spec compile, git hooks,
projections, and cutover follow in later phases of #339.
