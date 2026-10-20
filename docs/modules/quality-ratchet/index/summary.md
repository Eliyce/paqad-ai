# Quality Ratchet

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `quality-ratchet`

## Purpose

Quality rarely collapses at once — it erodes one small concession at a time, and
because each step is tiny nobody ever decides "let's make this worse." The
quality ratchet **records where four measures stand today** (the project's real
level, not an ideal) and from then on **only allows a change that keeps each
measure equal or better**. The recorded level can get stricter; it never
loosens, except via a deliberate, recorded exception.

Because the baseline starts from **today's reality**, day one is never an
impossible clean-up — the gate blocks *worsening*, not pre-existing debt.

## The four measures

All four are normalised to a **deficiency count where lower is always better**,
so "worse" is unambiguously "the number went up":

| Measure | What it counts | Source |
| --- | --- | --- |
| `tangledness` | complexity violations | per-language tool (e.g. ESLint complexity) via rule-scripts |
| `dead_code` | orphan / unused files | **consumed** from [#109's reachability solver](../../traceability-engine/index/summary.md) — one solver, two uses; never re-scanned |
| `risky_patterns` | risky-pattern / security findings | existing lint + pentest signals |
| `strictness` | strict flags that are **off** (looseness) | `tsconfig` strict flags, read directly |

Each measure is rolled up per module (reusing the module-health rollup's
attribution) plus a project total. A measure with no tool for the stack is
recorded **lower-confidence / blocked** — never a fabricated number, and a
blocked measure never blocks the gate.

## The ratchet rule

A change is allowed only if every measure is equal or better than the recorded
level. Because the recorded level is the *tightened minimum*, new work is held to
at least the existing level — the average can only climb (clean-as-you-code). A
measure with no baseline entry captures today's reality and never fails
retroactively.

The comparison runs as the `quality-ratchet` verification gate, reading the
result the verification phase plants on the context (alongside mutation
testing). A passing run tightens the baseline to the new minimums; a **refused
(regressed) run never writes the baseline**, so a rejected change can never
quietly move the line.

The gate's detail names the measures it took and the ones that were blocked
("measured: strictness, tangledness; blocked: dead code"), and on the fast lane
it says "strictness only" (issue #639, Part 10). A run that took no measure at
all (no result, a skipped run, or every measure blocked) reads **did not run**,
never a pass. It still never blocks: did not run keeps `passed: true`, so the
verdict does not change.

## Lane behaviour

- **`graduated` / `full`** — all four measures are evaluated.
- **`fast`** — trivial work is not blocked by complexity / dead-code / risky
  noise (only `strictness` is collected), **but it still cannot loosen the
  baseline**: a strictness-loosening fast change trips the gate.

## Legitimate regressions — approve once, reuse by kind

When a measure must legitimately worsen, the ratchet does not silently bend: it
opens a `quality.ratchet_exception` Decision Pause. The approval is **recorded
and reused for the same kind** via the Decision Pause Contract's
`findReusableDecision` (emitting `decision-reused`) — no re-ask. The rule stays
firm; exceptions are deliberate, visible, and get quieter over time. No second
memory is built — the DPC store is the memory.

## Why the code works the way it does

The reasons below are not obvious from the code in `src/quality-ratchet/`.

- **`baseline.ts`.** `.paqad/quality-baseline.json` keeps the lowest value seen per measure and
  module. Writes are atomic, and a corrupt file reads as no baseline, since the next run recaptures
  from reality. Tightening only lowers a value; a measure that could not be taken this run keeps
  its recorded value. Applying approved exceptions is the only path that raises a value, and only
  for the measure and module that were signed off.
- **`collector.ts`.** Files with no module still count toward the project total, which is the whole
  truth that modules localise. Strictness is always collected because the fast-lane guard depends
  on it. Complexity and risky patterns come from runners a project wires through its pack; a runner
  that is missing or throws means that measure is blocked, never a crash. Dead code is read from the
  traceability reachability result, and when that is unavailable it is blocked, not re-scanned.
- **`ratchet.ts` and `runner.ts`.** The comparison is pure, so the rule is tested per measure. The
  runner compares once with no approvals to learn which kinds worsened, reuses any earlier approval
  by kind, then raises a pause for each kind still blocking so the block is visible. Raising the
  pause is best-effort (one may already be pending for the task); the gate blocks either way. The
  runner never throws; a run it cannot do is recorded as skipped or blocked for the gate to judge.
- **`exception-decision.ts`.** The packet's fingerprint uses only the measure kind, so the same kind
  matches exactly and a later regression of that kind with different numbers still matches. Option
  keys are stable for the same reason. A reused decision that chose to hold the line is not treated
  as an approval.
- **`strictness.ts`.** It reads the canonical TypeScript strict flags rather than inventing a score:
  flags implied by `"strict": true` count as off only when set to false, the extra flags count as
  off unless set to true. `tsconfig.json` may contain comments and trailing commas, which
  `JSON.parse` rejects, so those are stripped and the parse retried; a file that still fails, or no
  `tsconfig.json` at all, means strictness is blocked rather than guessed.

## Boundaries

- The dead-code reachability solver itself is owned by
  [#109 traceability](../../traceability-engine/index/summary.md) — consumed here.
- Test strength / mutation score is owned by
  [#105 mutation testing](../../verification/mutation-testing.md) — it may report
  through the same rollup, but ratcheting it is a future extension (flagged, not
  built).
- Non-measurable preference findings stay in
  [#107 triage](../../verification/index/summary.md)'s taste pile; a measurable
  strictness/complexity regression is owned **here**.

## Source Footprint

- `src/quality-ratchet` — the baseline I/O (`baseline.ts`), the four-measure
  collector (`collector.ts` + `strictness.ts`), the pure ratchet comparison
  (`ratchet.ts`), the `quality.ratchet_exception` packet + reuse
  (`exception-decision.ts`), and the orchestrator (`runner.ts`).
- `src/verification/gates/quality-ratchet.ts` — the verification gate.
- `src/pipeline/phases/verification.ts` — wires the ratchet into the
  verification phase, consuming #109's orphan set for the dead-code measure.
- `src/planning/decision-packet.ts` — the `quality.ratchet_exception` category.
- Onboarded project — `.paqad/quality-baseline.json`.
