# Feature Spec — Site Map capability: deterministic core (P1, flag-gated OFF)

Status: **draft for freeze**. Lane: full. Owner: Haider. Date: 2026-07-27.
Input design: [`site-map-capability.proposal.md`](./site-map-capability.proposal.md), [`site-map-capability.plan.md`](./site-map-capability.plan.md), [`site-map-capability.addendum.md`](./site-map-capability.addendum.md). This spec scopes only the **non-UI deterministic core** of the plan's Phase 1. The dashboard Site map area and the human journey-curation layer are deferred to a later spec.

## 1. Summary

Add a machine-readable behavioural map of an application — surfaces, transitions, guards, actors, and curated journeys — under `docs/instructions/site-map/`, produced by a deterministic `paqad-ai sitemap` engine that mirrors the codebase-health pattern (an injectable gatherer produces facts, a pure core assembles, the exit code is the verdict). The whole capability sits behind an OFF-by-default `site_map` framework flag: with the flag off, nothing about existing behaviour changes. Every artifact is schema-versioned, AJV-validated, and evidence-anchored (`file:line`), and each run summary lands on the shared session-ledger so it flows into `paqad-ai audit export`.

## 2. Scope

In scope: the `app-map.yaml` + per-journey YAML schema and its AJV validators; a schema-versioned persistence layer (atomic write, tolerant read); the `SM-` finding identity and baseline ratchet; the session-ledger doc type; a node-cli surface extractor with a generic fallback; the engine orchestrator with an injectable gatherer; the `paqad-ai sitemap` CLI verb; Tier-A verification; publication (index, overview, registries); the `site_map` flag; the instructions-area allowlist entry; routed-workflow registration; the fine-grained skills, the two new agent roles, and the workflow rule; the freshness gate, stale-path wiring, maintainer, and `site-map-retest`.

Out of scope (deferred): the React dashboard Site map area, journey playback, the first-run guided flow, lenses (actor/locale/flag), i18n coverage findings, flag-debt findings, and the extension catalog (proposal §6 / addendum §6).

## 3. Functional requirements

- FR-1: The engine validates the canonical `app-map.yaml` and each per-journey YAML against a versioned AJV schema, and a schema-invalid or corrupt artifact is read as absent rather than trusted.
- FR-2: Surface extraction is deterministic and injectable: a production gatherer performs the real filesystem work and a fake gatherer drives the whole run offline in tests, so detection costs zero model tokens.
- FR-3: An unavailable extractor is recorded as a blocked check with a reason and an install hint, and the run proceeds; a blocked check is a gap, never a silent pass.
- FR-4: Each finding carries a content-addressed stable `SM-` identity so a later retest matches the same finding across runs, and a baseline ratchet marks findings new-since-baseline or pre-existing.
- FR-5: Each run writes a run summary row to the shared session-ledger under its own doc type so the run appears in `paqad-ai audit export`.
- FR-6: The `paqad-ai sitemap` CLI verb runs the audit and returns exit code 0 when clean, 1 when findings exist, and 2 on an unexpected error.
- FR-7: Tier-A verification is deterministic and total: every cited `file:line` must resolve, every transition target and guard reference must exist, every extracted surface must be mapped or explicitly excluded with a reason, and graph invariants (reachability, dead ends, guard-less sensitive surfaces) are computed and recorded.
- FR-8: Publication emits a token-budgeted `index.md`, a human `overview.md` with deterministically generated Mermaid, and registry projections, registering each output in the doc tracker for differential refresh.
- FR-9: The capability is gated by a `site_map` framework-config flag (env `PAQAD_SITE_MAP`, group `app`, default false) that additionally requires the coding capability at its consumers.
- FR-10: The `site-map` and `site-map-retest` workflows are registered across the classification union, the routed-outcome map, the deterministic phrase table, the routing-rules table, the agent-bootstrap workflow list, and the finding-normalizer, mirroring codebase-health.
- FR-11: A `SiteMapFreshnessGate` joins the verification gate registry and the `site-map-retest` workflow replays prior `SM-` findings by stable id with verdicts fixed / still-open / needs-manual-verification.

## 4. Acceptance criteria

- AC-1: Given the `site_map` flag is off, when any existing workflow runs, then no site-map artifact is produced and no existing behaviour changes. (proof: automated)
- AC-2: Given a schema-valid `app-map.yaml` fixture, when it is validated, then validation passes; given a fixture with an unknown property or a missing required field, when it is validated, then validation fails with a path-anchored error. (proof: automated)
- AC-3: Given a corrupt or schema-invalid app-map on disk, when the store reads it, then the store returns null rather than a partial object. (proof: automated)
- AC-4: Given a fake gatherer with a fixed clock, when the engine runs, then the run completes offline and produces a deterministic run id and report with no network or shell access. (proof: automated)
- AC-5: Given two runs over identical inputs, when findings are assembled, then each finding receives the same `SM-` id across both runs. (proof: automated)
- AC-6: Given a completed run, when the ledger is read, then a single site-map-run summary row exists for it and `paqad-ai audit export` includes that row. (proof: automated)
- AC-7: Given a map whose transition names a target surface that does not exist, when Tier-A verification runs, then it records a cross-reference finding; given a map citing a `file:line` that does not resolve, then it records an evidence finding. (proof: automated)
- AC-8: Given the CLI verb runs on a clean map, when it exits, then the exit code is 0; given findings, then 1; given an unexpected error, then 2. (proof: automated)
- AC-9: Given the site-map skill folders and agent roles, when the skills meta-test runs, then every folder satisfies the folder contract (section order, line budget, openai.yaml, cited references). (proof: automated)
- AC-10: Given a change touching flow-relevant files with a stale map, when the freshness gate runs, then it reports needs-your-attention; given a fresh map, then it passes. (proof: automated)
- AC-11: Given a prior run's `SM-` findings, when `site-map-retest` runs against fresh evidence, then each finding is replayed by its stable id with a fixed / still-open / needs-manual-verification verdict and no finding is invented or downgraded. (proof: automated)

## 5. Invariants

- INV-1: With the `site_map` flag off, the capability is completely inert — no artifact is written, no rule bytes are compiled, and no existing route, gate, or output changes.
- INV-2: The engine never authors extracted facts; the model contributes only non-inferable fields (names, journey intent, guard semantics), and every model-written field is evidence-anchored and Tier-A-verifiable.
- INV-3: The stored bytes of every rigid artifact are owned by the script: the model fills templates, the verb validates, hashes, and writes, and a schema-invalid artifact is never persisted.
- INV-4: A finding's stable `SM-` identity is a pure function of its content, so retest matching is reproducible and independent of run order.
- INV-5: Deterministic (Tier-A) results and any model-judged results are graded and reported separately; an unestablished result is recorded as blocked, never flattened into a pass.
- INV-6: The illustrative `docs/specs/site-map-samples/` files are not modified by this change; strictly-valid schema fixtures live under `tests/fixtures`.

## 6. Verification

Every AC above is proven by an automated unit or integration test at 100% coverage of the new modules, exercised offline through the injectable gatherer. Routed-workflow registration is guarded by the existing drift and router tests plus new site-map registration assertions. The full `pnpm run ci` gate (typecheck, lint, format, 100%-coverage tests, build) must pass before merge.
