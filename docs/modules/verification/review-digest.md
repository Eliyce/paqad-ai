# Review Evidence Digest

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Slug:** `verification/review-digest` &nbsp;·&nbsp; **Issue:** #360

## Purpose

Review was the weakest stage in the pipeline. paqad proved a review **file** existed — it
hashed the bytes and folded a bare marker to inconclusive — but the content was the model
grading its own homework with no hard facts in front of it. Meanwhile paqad had already
computed those facts and left them scattered across four cached artifacts that nothing
composed.

The digest fixes both halves. It hands the review stage a small, machine-built table of
what the tooling already proved, and it makes ignoring that table detectable: the
`implementation-review` gate fails when a deterministic, file-anchored, high-severity
finding is never cited by `file:line` in the recorded `review.json`.

The reviewer stops opining in a vacuum and starts confirming or contesting evidence.

## What it composes

`paqad-ai review digest` writes `.paqad/session/review-digest.md` with four sections in a
fixed order, hard-capped at 150 lines:

| Section | Content |
| --- | --- |
| `## Change` | The active feature, the cached changed-file list, and the folded per-stage state. |
| `## Spec` | The frozen acceptance criteria with their `proof_type`, from the bundle's `specification.json`. |
| `## Machine findings` | One row per finding: `source \| severity \| tier \| file:line \| message`. |
| `## Blind spots` | What **no** machine checked — semantic duplication, architectural fit, naming, whether the tests assert the right thing, rollback risk. |

The blind-spot section is not decoration. It is what stops the digest from reading as "all
green means all clear", and it tells the reviewer exactly where their judgment is the only
coverage there is.

## The four sources

`collectMachineFindings` (`src/review-digest/sources.ts`) unions them in a fixed order, so
the digest is stable between runs:

| Source | Cached at | Contributes |
| --- | --- | --- |
| Rule scripts (#89) | `.paqad/scripts/rules/.cache/report.json` | Findings with their own severity and `deterministic`/`heuristic` tier. |
| Duplication (#358) | `.paqad/scripts/rules/.cache/duplication.json` | Near-copies; the detector's band **is** the severity (deterministic → high, heuristic → medium). |
| Checks (#318) | `.paqad/checks/last-run.json` | One row per command plus one per recorded failure. |
| Verification evidence | `.paqad/session/verification-evidence.json` | Every failing or inconclusive gate, flattened one failure per row — including unresolved doc targets. |

A source that is absent, empty, or unparseable contributes zero rows and never throws.
Every read is a direct read of a known path: **no subprocess, no network, no filesystem
scan, no model call.** A real run measures ~0.25s.

This replaces `runtime/base/skills/adversarial-review/scripts/digest-evidence.sh`, whose
gate-failure flattening is ported here in cross-platform Node. The shell script remains a
skill resource; it is no longer the engine.

## The gate's teeth

`ImplementationReviewGate` re-derives the rows through the **same collector** rather than
parsing the written digest (decision `D-01KY1TV1GFZ3CABQYWQR753XKT`). That is deliberate:
reading the digest file would mean skipping `review digest` silently disarms the check,
which is exactly the failure the issue exists to prevent.

Only rows that are **deterministic AND file-anchored AND in the high/blocker/critical
band** can fail a review. Everything else — a heuristic near-copy, a passing check, an
anchor-less gate verdict — is context and can never block. Matching is plain string
containment of the `file:line` anchor: it asks "did the reviewer look at this place?",
never "is the prose any good", which keeps the gate deterministic and un-arguable.

With no machine findings on record, the gate behaves exactly as it did before this
feature, and the pre-existing decision-violation failure still fires ahead of the
anchoring check.

## Honest limits

- The changed-file header reads the cached `.paqad/session/changed-files.json` only.
  Reading `git status` would be a subprocess and break the cached-reads-only budget, so an
  absent list renders `none recorded` rather than making the digest expensive.
- Doc drift reaches the digest through the canonical-docs gate's failures, not by running
  the stale-doc detector (also a subprocess). Before verification has run once, doc drift
  is **absent** from the digest rather than proven clean.
- Truncation is always announced. A silently clipped digest would read as "that was
  everything", which is the false confidence this feature exists to remove.

## Source Footprint

- `src/review-digest/sources.ts` — the collector, the anchor rules, and the
  unaddressed-finding check the gate uses.
- `src/review-digest/digest.ts` — the pure markdown composer and the 150-line cap.
- `src/review-digest/write.ts` — reads the cached inputs and persists the digest.
- `src/cli/commands/review.ts` — the `paqad-ai review digest` verb.
- `src/verification/gates/implementation-review.ts` — the tightened gate.

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml)
(feature slug `review-digest` under the `verification` module). If anything here
disagrees with the map, the **map wins**.
