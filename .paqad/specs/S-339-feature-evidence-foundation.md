# Specification — S-339 Per-feature evidence bundle foundation (dark)

## Behaviour

- FR-1: A feature-dir resolver produces
  `.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/` when an issue ref is
  present, and `<slug>-<ULID>/` when it is absent, reusing `deriveSlug`,
  `detectTicketRefs`, and a script-minted `ulid()`.
- FR-2: A feature dir name round-trips: parsing `<issue>-<slug>-<ULID>` (or
  `<slug>-<ULID>`) yields back `{ issue, slug, ulid }`.
- FR-3: `feature.json` and `plan.json` validate against framework-owned AJV
  schemas that reject unknown keys; the record builders stamp a deterministic
  SHA-256 `content_hash` over identity fields (excluding volatile timestamps).
- FR-4: `specification.json` reuses the existing `FeatureSpec` shape — no new
  spec-building logic is introduced.
- FR-5: The `_session/<sessionId>.json` control holds one active feature plus a
  paused-feature stack and a lane; setting a new active feature pushes the prior
  active onto the paused stack; resuming a paused feature pops it and pushes the
  current active; mark-done clears active.
- NFR-1: Phase 1 is dark — no live recorder, capability gate, workflow-state,
  CLI, or runtime hook is modified, so the feature-development stage spine is
  unchanged.

## Acceptance criteria

- AC-1: Given a title and issue `#339`, when a feature dir name is minted, then
  it matches `339-<slug>-<26-char ULID>` and parses back to
  `{ issue:"339", slug, ulid }`. (proof: automated)
- AC-2: Given a title and no ticket ref, when a feature dir name is minted, then
  it matches `<slug>-<ULID>` and parses back to `{ issue:null, slug, ulid }`.
  (proof: automated)
- AC-3: Given a `feature.json` / `plan.json` record with an unknown extra key,
  when validated, then validation fails with a key error. (proof: automated)
- AC-4: Given the same identity fields, when a record is built twice with
  different timestamps, then `content_hash` is identical. (proof: automated)
- AC-5: Given a session control with active feature A, when feature B is set
  active, then active is B and paused contains A; when A is resumed, then active
  is A and paused contains B. (proof: automated)
- AC-6: Given no existing control file, when read, then a well-formed empty
  control (`active:null, paused:[], lane:null`) is returned. (proof: automated)

## Invariants

- INV-1: A feature dir name is immutable once minted — the resolver never
  rewrites the ULID for an existing feature.
- INV-2: Stored JSON is script-owned — schemas reject unknown keys so a
  hand-authored field cannot enter the bundle.

## Open questions

_None — Phase 1 scope is fully determined by the issue's phase sequence._
