# Verification Gates

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `verification` &nbsp;·&nbsp; **Issue:** #117

## Purpose

Because there is no second human reviewer, paqad's own checks carry all the
weight — so the framework needs a single, deterministic answer to "is this change
allowed to land?" This module is the **gate runner** and the **bank of gates**
that produce that answer. Each gate inspects the change and returns a pass / block
verdict with computed judgment inputs; the runner aggregates the verdicts,
computes a delta versus the last run, and emits the evidence that the
[`evidence-ledger`](../../evidence-ledger/index/summary.md) and the per-change
receipt consume. Gates fire from hooks, with a git/CI backstop so the result binds
even when the agent is out of the loop.

## The bar

A gate's verdict is only trustworthy if its inputs are computed, not asserted.
Every gate therefore returns its judgment inputs alongside the verdict, and the
runner records **why** a gate passed or blocked — not just the boolean. A blocked
or inconclusive gate downgrades the run; it never hides inside a pass total. The
strength of each verdict (deterministic vs LLM-judged) is graded downstream by the
evidence ledger, never pooled.

## The gate bank

The gates under `src/verification/gates/` cover correctness, completeness, quality,
and documentation:

| Gate | Concern |
| --- | --- |
| `ac-test-mapping` | Every acceptance criterion maps to a proving test. |
| `behavioral-correctness` | The change does what the spec says. |
| `change-completeness` | The change is whole — no half-applied edits. |
| `code-tests-lint` | Tests, types, and lint pass. |
| `mutation-testing` | Tests would actually catch a behaviour-changing mistake (#105). |
| `quality-ratchet` | No quality measure regresses (see [`quality-ratchet`](../../quality-ratchet/index/summary.md)). |
| `requirement-completeness` | Requirements are fully addressed. |
| `spec-review` / `story-quality` / `implementation-review` | LLM-judged quality of the spec, story, and implementation. |
| `architecture-compliance` / `database-quality` / `extension-surface` | Structural and contract conformance. |
| `documentation-freshness` / `documentation-checks` / `instructions-docs-structure` / `module-docs-structure` | Docs are present, current, and well-formed. |

## Feature Pages

- [Mutation Testing — Verification Gate](../mutation-testing.md) — plant mutants in
  the changed code and confirm the tests catch every behaviour-changing one (#105).
- [Flaky-Test Handling — Trust in a Pass](../flaky-handling.md) — own the
  test-trust signal so a green run means green (#106).

## Source Footprint

- `src/verification/gate-runner.ts` — runs the bank, aggregates verdicts.
- `src/verification/delta.ts` — computes the change versus the last run.
- `src/verification/gates/**` — the individual gates (and `gate.interface.ts` /
  `shared.ts` infra).
- `src/verification/evidence.ts`, `evidence-markdown.ts` — structured + Markdown
  evidence emission (also rendered by the `evidence` CLI command).
- `src/verification/repository/**` — the repository-facing inputs the gates read.

## Boundaries

This module **owns** the verdict and the evidence row for each gate. It does
**not** own the ledger or the receipt (that is `evidence-ledger`), the SIEM
projection (`cli-audit`), or the quality baseline itself (`quality-ratchet`) — it
consumes the ratchet's output and emits a verdict. It decides; other modules
record and project.

## Authority

The single source of truth for this module's identity, slug, feature names, and
source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins** — update the map first,
then regenerate this page via `create module documentation`.

## Related

- Evidence ledger + provenance receipt: [`evidence-ledger`](../../evidence-ledger/index/summary.md)
- Quality ratchet (a gate input): [`quality-ratchet`](../../quality-ratchet/index/summary.md)
- Bidirectional traceability: [`traceability-engine`](../../traceability-engine/index/summary.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
