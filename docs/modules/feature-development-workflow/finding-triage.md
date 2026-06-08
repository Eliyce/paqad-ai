# Finding Triage — Act Only on Confirmed Problems

> **Slug:** `finding-triage` &nbsp;·&nbsp; **Issue:** #107 &nbsp;·&nbsp; **Owns:** the four-pile sort before any responsive change

## Why this exists

As paqad works it produces a stream of "things that look like problems": gate results plus its own
re-reading second-guesses (gap-detector, adversarial-reviewer, final-reviewer, spec-review defects).
That stream is a **mixture** — real defects, matters of taste, plain misreads, and signs the *spec* was
unclear. If everything is treated as "a problem to fix," the agent churns working code to satisfy taste
and chase non-issues, and **every change to working code is a fresh chance to introduce a real defect.**

The honest nuance, encoded deliberately: LLM reviewers over-flag (real tools report ~5–15%
false-positive rates), and asking the model to *explain its judgement and propose a fix* makes it worse —
it invents errors in correct code. The proven industry answer is a dedicated **sort-first** step. So
before acting on any finding, it is sorted into exactly one of four piles; only the confirmed pile leads
to a code change.

## The four piles (Settled)

| Pile | Meaning | Route |
| ---- | ------- | ----- |
| **Confirmed problem** | Demonstrable — ideally already reproducible (#103). | → a code change, via the prove-it protocol. |
| **Unclear spec** | Really "the spec didn't say." | → the spec (#102), **not** a code patch. |
| **False alarm** | A misread / not a real problem. | → set aside with a recorded reason. |
| **Taste** | A different-but-fine way to write it. | → recorded, **not** acted on. |

The honesty rule: **"confirmed" must mean *demonstrable*, not asserted.** A confirmed-but-not-yet-
reproducible finding waits in a `needs-repro` sub-state and does **not** drive a change until #103's
protocol reproduces it. Only a confirmed **and** demonstrable finding may edit code — everything else
(taste, false-alarm, unclear-spec, needs-repro, ratchet, ambiguous) cannot.

## The rules (Settled)

- Every finding is sorted into exactly one of the four piles before any change.
- Only confirmed problems lead to code changes.
- "Unclear spec" items go to the spec, not a code patch.
- False alarms are set aside with a recorded reason.
- Clear cases sort automatically; only genuinely ambiguous ones go to the human.
- Already-settled findings (including a taste settled "not doing it") are read from saved decisions and
  never re-raised, matched by kind. **No second memory** — it reuses the Decision Pause Contract.
- "Confirmed" must mean demonstrable; tool-agnostic; no heavy ceremony on small work.

## How it works

| Step | Where |
| ---- | ----- |
| Sort a finding into a pile from its evidence signals (rules first) | `src/triage/classifier.ts` (`classifyFinding`) |
| Apply lane behaviour — `fast` is automatic & prompt-free | `src/triage/classifier.ts` (`triageFinding`) |
| Enforce "only confirmed-demonstrable drives a change" | `src/triage/classifier.ts` (`canDriveCodeChange`, `changeDrivingVerdicts`) |
| Record each pile + reason (auditable, traceable) | `src/triage/ledger.ts` (`.paqad/findings/triage.json`) |
| Ask the human only on genuine ambiguity, reuse by kind | `src/triage/finding-triage-decision.ts` (`finding.triage` Decision Pause) |

### Classifier mechanism (open decision #1 — rules first)

A rules-first pass maps evidence type → pile (cheap, deterministic); only the residue — findings with no
decisive signal — is genuinely ambiguous. Per the research, the classifier does **not** ask the model to
over-explain. The deterministic signals a finding carries (`gate_failed`, `reproducible`, `behavioural`,
`spec_silent`, `style_only`, `measurable_quality`, `refuted_by_evidence`) are read in priority order.

### Lane behaviour

Triage adds no heavy ceremony to small, low-risk work. On the `fast` lane it is a cheap automatic pass:
an ambiguous finding is set aside (recorded), never prompted. Human escalation happens only on genuine
ambiguity, and only off the `fast` lane.

### Settle once, never re-raise

Before asking, saved decisions are read; anything already settled — including a taste settled as "not
doing it" — is filtered and not brought up again. This reuses `findReusableDecision` (fuzzy by kind,
≥0.8) and emits `decision-reused`, so false-alarm and taste verdicts genuinely make the system quieter
over time. The `finding.triage` Decision Pause category fingerprints by *kind*, so two same-kind
ambiguous findings share one verdict.

## Boundaries (what this does NOT own)

- **Proving** a confirmed problem and fixing it → [#103 fix-protocol](features/fix-protocol/business.md).
  Triage hands a confirmed finding off to that prove-it protocol; it does not prove anything itself.
- The **spec content** the "unclear" pile lands in → [#102 spec & done bar](features/spec-and-done-bar/business.md).
- A **measurable quality regression** masquerading as taste → #110 quality ratchet (open decision #3):
  such a finding is routed to the ratchet, **not** binned as taste.
- The outer **build-check-fix loop** that consumes triage verdicts → #108.
- The **settle-once memory** itself is the shipped Decision Pause Contract — triage reuses it, never a
  second store.

## Related

- [Decision Pause Contract](../decision-pause-contract/index/summary.md) — the reused settle-once memory.
- [`.paqad/decision-pause-contract.md`](../../../.paqad/decision-pause-contract.md) — lists the
  `finding.triage` category.
