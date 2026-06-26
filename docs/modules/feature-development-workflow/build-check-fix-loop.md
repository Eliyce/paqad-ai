# Build-Check-Fix Loop — Work Quietly, Stop Honestly

> **Slug:** `build-check-fix-loop` &nbsp;·&nbsp; **Issue:** #108 &nbsp;·&nbsp; **Owns:** the outer loop — bounded rounds, quiet UX, one honest "stuck" report

## Why this exists

The person asked for a result, not a seat in the messy middle. paqad should run
the build → check → fix cycle **quietly** — the person never sees "found a
problem, fixed it, found another" (that is plumbing) — and it must not loop
forever. Unbounded automated repair stalls or oscillates: iterative program
repair shows **diminishing returns** past a threshold and can introduce
regressions, and coding agents "fail expensively" when they lack **futility
detection** and burn budget until an external cap stops them. The fix is a
runtime-enforced bound plus escalation: the *system running the agent*, not the
agent's own judgement, guarantees termination and then escalates honestly.

Before this, the pipeline was single-pass: verification ran the gates once and
blocked on the first failure (`src/pipeline/phases/verification.ts`). There was
no rounds construct, no cap, and no quiet-then-one-message UX.

## The loop (Settled)

One round = build/change → run checks → if not `isDone()` (#102), triage
findings (#107) → fix confirmed problems via the prove-it protocol (#103) → next
round. The loop is the **only** place rounds live; #103 and #107 stay pure (no
looping inside them).

- **Bounded.** A lane-scaled `max_rounds` cap, enforced by the pipeline runtime
  — not the agent's discretion. Defaults: `fast` 2, `graduated` 3, `full` 5
  (open decision #1, taking the recommendation). Project-tunable via the
  `rounds:` block in `docs/instructions/workflows/feature-development.yaml`; raise it for
  the heaviest work.
- **Futility detection.** No net progress across rounds — the same failing set
  twice in a row — stops early rather than burning the full budget (open
  decision #2: no-progress + same-failing-set; richer oscillation detection can
  come later).
- **Quiet by default.** Rounds, and the problems found/fixed within them, are
  **not** surfaced. The round-by-round record is persisted internally to
  `.paqad/session/build-check-fix-rounds.json` for the agent's own stop decision
  and for debugging.
- **One honest message.** The only thing the person hears during the loop
  (short of the finished result) is, at the cap or futility limit while still
  unclean, a single plain report via the `stop` escalation: where it stands
  (failing gate / AC), the last evidence, rounds used, and the one or two things
  a human must decide (open decision #4).

## Lane behaviour

This *is* the lane behaviour: `fast` gets few rounds and the lightest loop;
`full` gets the most. Trivial work that passes round 1 returns immediately and
never feels the machinery.

## How it works

| Step | Where |
| ---- | ----- |
| Run the bounded loop: count rounds, detect futility, decide done / cap / stop | `src/loop/build-check-fix-loop.ts` (`runBuildCheckFixLoop`) |
| Resolve the lane-scaled cap (project override wins) | `src/loop/build-check-fix-loop.ts` (`resolveMaxRounds`), defaults in `src/core/types/build-check-fix.ts` |
| Wrap the single verification pass as round N's "check" | `src/pipeline/phases/verification-loop.ts` (`VerificationLoopPhase`) |
| The done condition the loop checks | `src/spec/definition-of-done.ts` (`isDone`, #102) |
| Persist the internal rounds log | `src/loop/rounds-log.ts` (`.paqad/session/build-check-fix-rounds.json`) |
| Per-lane round-cap override | `docs/instructions/workflows/feature-development.yaml` › `rounds:` |
| The stop rule, documented for the human | `runtime/base/checklists/human-escalation.md` |

The loop never prints; it returns its outcome as data. `VerificationLoopPhase`
is transparent when the work converges (it hands back the inner pass result) and
emits the single `stop`-escalation report only when the loop stops unclean.

## Relationship to the slice circuit-breaker (open decision #3)

Both are kept. The per-slice retry attempts and circuit breaker
(`src/planning/slice-executor.ts`, `src/planning/slice-circuit-breaker.ts`) are
a *task-level* cap; this loop adds a *feature-level* round cap and reuses the
same signature-based no-progress pattern. A slice that exhausts its attempts
feeds the feature round/stop decision rather than producing a separate user
message — one honest "stuck" report, not two.

## Boundaries (what this does NOT own)

- What one fix does inside a round (prove → fix → no-regression) →
  [#103 fix-protocol](features/fix-protocol/business.md).
- Deciding which findings are real before fixing → [#107 finding triage](finding-triage.md).
- The definition of "done" the loop checks → [#102 spec & done bar](features/spec-and-done-bar/business.md).
- Strengthening the checks themselves → #105 mutation testing & #106 flaky-test detection.
- The quality ratchet that some findings route to → #110.

## Related

- [`runtime/base/checklists/human-escalation.md`](../../../runtime/base/checklists/human-escalation.md)
  — the stop rule, for the human.
- [Finding Triage](finding-triage.md) — supplies the confirmed-demonstrable
  verdicts the loop acts on.
