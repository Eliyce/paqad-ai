# Flaky-Test Handling — Trust in a Pass

> **Slug:** `flaky-handling` &nbsp;·&nbsp; **Issue:** #106 &nbsp;·&nbsp; **Owns:** the test-trust signal

## Why this exists

Some checks pass or fail at random without the code changing — timing, ordering, shared state,
network. The real danger isn't the wasted re-run; it's **trust erosion**: once the agent learns checks
sometimes fail for no reason, it starts waving real failures through as "probably just flaky." Every
other check-based protection in this suite assumes green means good, so this is the feature that keeps a
green result worth trusting.

The honest nuance, encoded deliberately: blanket-ignoring flaky *failures* is dangerous. On Chromium CI,
even a 99.2%-precision flaky classifier would miss ~76% of true regression faults if its failures were
ignored — flaky tests still catch >1/3 of real regressions (Haben et al., 2023). That is exactly why the
default is **assume-real-first**, not **assume-flaky**.

## The rules (Settled)

- **Assume real first.** Every failure is a real problem until a real cause is ruled out. Flaky is never
  the default label.
- **A quarantined flaky test stops blocking *and* stops giving false comfort**, stays clearly tracked,
  and touching related code forces a fix.
- **Common randomness causes** (timing, order, shared state, network) are surfaced for root fixing.
- **Setting aside is never silent deletion** of protection.
- Don't grind forever on a genuinely flaky test once its cause is understood.
- Tool-agnostic.

## How it works

| Step | Where |
| ---- | ----- |
| Judge stability by bounded re-runs (flip detection) | `src/flaky/stability.ts` (`judgeStability`, reuses the pass/fail-transition model behind `test-output/service.ts`) |
| Resolve / clamp the re-run count | `src/flaky/stability.ts` (`resolveRerunCount`, `custom.flaky.rerun_count`) |
| Surface root-cause smells | `src/flaky/smells.ts` (`detectFlakinessSmells`) |
| Persist the quarantine (tracked, never deleted) | `src/flaky/registry.ts` (`.paqad/flaky-tests/registry.json`) |
| Apply quarantine over a result (blocking vs set-aside; meaningful-green) | `src/flaky/quarantine.ts` (`applyQuarantine`) |
| Link a test to its module(s) / force-fix on touch | `src/flaky/attribution.ts`, `src/flaky/touch-gate.ts` |
| Clear only on empirical stability | `src/flaky/clear.ts` (`clearQuarantineWithEvidence`) |
| Ambiguous rare-real vs flaky | `src/flaky/flaky-judgement-decision.ts` (`test.flaky_judgement` Decision Pause) |

### Re-run count (open decision #1)

Small by default (**3**), project-tunable via `custom.flaky.rerun_count`, clamped to `[2, 10]`. Re-runs
fire **only** on suspected-flaky, non-quarantined failures, so CI cost stays bounded.

### Quarantine authority (open decision #2)

A **clear flip** (passed and failed across the re-runs) is auto-quarantined. A **lone flip** — one
failure among many passes, or one pass among many failures — is the rare-intermittent case and is routed
to a `test.flaky_judgement` Decision Pause: asked once, then reused by kind (no second memory).

### Meaningful green

`applyQuarantine` moves a quarantined test's failure out of the *blocking* set so it stops blocking the
gate — but the result is only **meaningful green** when no active quarantine applies. A pass that rests
on a set-aside test gives false comfort, so the caller must surface it rather than wave work through.

### Forced fix on touch

A quarantined test records the module(s) it belongs to (attributed via the same `module-map` machinery
the health rollup uses). On `graduated`/`full` lanes, the next change touching one of those modules makes
fixing the quarantined test part of that work — the touch gate blocks. `fast`-lane changes are never
blocked: cheap detection runs everywhere, the forced-fix gate does not.

### Clearing a quarantine (open decision #3)

Clearing requires **empirical stability**: the post-fix re-runs must all pass (`recovered`). A claimed
fix is never trusted — Lam et al. (Microsoft, ICSE 2020) found developer-claimed flaky fixes frequently
don't actually reduce flakiness. A still-flapping or still-failing result keeps the quarantine in place.
The entry is kept either way; clearing is an explicit, evidenced status change, never a silent removal.

## Reuse, not rebuild

- **Test results** come from `test-output/service.ts` (stable `test_id`s) and its pass↔fail delta model
  — there is no parallel result store.
- **Quarantine flags** annotate `verification/evidence.ts` failures via `AnnotatedFailure`.
- **Per-module rollup** reuses `module-map` attribution (the same primitives `module-health/rollup.ts`
  uses).
- **Ambiguous judgement** reuses the Decision Pause Contract (`findReusableDecision`, reused by kind).

## Decision category

`test.flaky_judgement` — *"Is this a flaky test or a rare real fault?"* Reversibility `moderate`,
TTL 30 days. Documented in the Decision Pause Contract category list.

## Sources

- Micco, *Flaky Tests at Google and How We Mitigate Them* (2016).
- Haben et al., *Discerning Flaky from Fault-triggering Test Failures: Chromium CI* (2023).
- Lam et al., *A Study on the Lifecycle of Flaky Tests* (Microsoft, ICSE 2020).
- Eck et al., *Understanding Flaky Tests: The Developer's Perspective* (FSE 2019).
