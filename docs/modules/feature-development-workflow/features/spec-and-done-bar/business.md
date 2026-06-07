# Feature Spec & "Done" Bar

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Slug:** `spec-and-done-bar` &nbsp;·&nbsp; **Issue:** #102

## What it is

Before any non-trivial feature is built, paqad requires **one short, agreed, machine-checkable spec**.
The spec states three things and is then **frozen** for that work:

- **Behaviour** — what the feature does (the summary and functional/non-functional requirements).
- **Acceptance criteria** — the `AC-n` conditions, in Given/When/Then form, that must be true for the
  feature to count as correct. Each carries a proof type.
- **Invariants** — the `INV-n` rules the feature must never break, auto-suggested from the project's
  rules and confirmed by a human.

Once frozen, "done" stops being a feeling and becomes a single checkable bar: **verification gates
pass**, **every frozen acceptance criterion is built and proven**, and **self-review surfaces no
confirmed problem**. Style and taste never block done.

## Why it matters

Requirements problems are the dominant, most expensive class of software defect, and a build loop with
no "done" line never terminates. Fixing the target before coding removes rework before a line is
written, and a checkable bar gives autonomous loops a place to stop.

## How it behaves

- **Trivial work stays light.** The `fast` lane skips the specification stage entirely — a one-line or
  cosmetic change is never forced into a spec. The discipline only binds on `graduated`/`full` lanes.
- **Goals never drift quietly.** A real mid-build goal change pauses (`spec.change`), updates the spec,
  re-confirms, and re-freezes before work continues.
- **Contradictions are never resolved silently.** When the work conflicts with the frozen spec, the
  agent pauses (`spec.contradiction`) and asks the human to *fix the code* or *change the spec*.

## Boundaries

This feature owns the spec object and the "done" bar. It does not run the proofs
([#103](https://github.com/Eliyce/paqad-ai/issues/103), [#105](https://github.com/Eliyce/paqad-ai/issues/105),
[#106](https://github.com/Eliyce/paqad-ai/issues/106), [#108](https://github.com/Eliyce/paqad-ai/issues/108)),
slice the spec into work units ([#104](https://github.com/Eliyce/paqad-ai/issues/104)), or build the
spec↔code↔test map ([#109](https://github.com/Eliyce/paqad-ai/issues/109)). Those consume the spec this
feature freezes.
