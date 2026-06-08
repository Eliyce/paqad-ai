# Mutation Testing — Verification Gate

> **Slug:** `mutation-testing` &nbsp;·&nbsp; **Issue:** #105 &nbsp;·&nbsp; **Gate:** `mutation-testing`

## Why this exists

Because there is no second human reviewer, paqad's own checks carry all the weight — so "the tests
passed" must mean "the tests would actually catch a mistake," not just "every line ran." Coverage is a
weak proxy for test effectiveness (Inozemtseva & Holmes, ICSE 2014); the established fix is **mutation
testing**: plant small behaviour-changing mistakes (mutants) in the changed code, run the existing
tests against each, and confirm they catch every behaviour-changing mutant. Survivors point precisely
at weak checking.

## The bar

- Every mutant that **could change behaviour must be killed**.
- **Equivalent mutants** — semantically identical changes that cannot be killed — are **set aside** and
  do not count against the bar. Errored/uncompilable mutants are likewise excluded.
- The score is `kill_rate = killed ÷ (killed + survived)`, where `killed` includes timeouts and
  `survived` includes no-coverage mutants. It is `null` when there are no eligible mutants.

## How a run works

| Step           | Where                                                  |
| -------------- | ------------------------------------------------------ |
| Select tool    | `src/mutation/adapter.ts` (`selectMutationTool`)       |
| Scope to diff  | `src/mutation/scope.ts` (`scopeMutationTargets`)       |
| Orchestrate    | `src/mutation/runner.ts` (`runMutationGate`)           |
| Compute bar    | `src/mutation/outcome.ts` (`computeMutationOutcome`)   |
| Gate           | `src/verification/gates/mutation-testing.ts`           |
| Evidence       | `src/verification/evidence.ts` (survivors + confidence) |
| Per-module roll-up | `src/planning/module-health-updater.ts` (`mutation_score`) |

The runner is wired into the verification phase (`src/pipeline/phases/verification.ts`): it runs **only
after the suite is already green**, scoped to the changed source files, and writes its result onto the
verification context as `mutation_result`. The gate then turns that result into a pass / inconclusive /
fail outcome that flows through the existing verification evidence — there is no parallel store.

## Per-language tool (no home-grown mutator)

The adapter maps the project's detected stack to its **mature** mutation tool and never writes a
home-grown mutator:

| Language       | Tool            | Confidence |
| -------------- | --------------- | ---------- |
| TypeScript/JS  | Stryker         | mature     |
| C# / .NET      | Stryker.NET     | mature     |
| Java / JVM     | PIT             | mature     |
| Python         | mutmut          | mature     |
| PHP            | Infection       | mature     |
| Ruby           | mutant          | mature     |
| Rust           | cargo-mutants   | mature     |
| anything else  | best-available  | **lower**  |

The onboarded project supplies the tool as a dev dependency plus its config; the runner detects that
configuration before running and skips cleanly when it is absent.

## Lower-confidence semantics

Long-tail languages (Elixir, Haskell, OCaml, Kotlin, …) have weak or abandoned mutation tooling. For
those the adapter returns a **lower-confidence** descriptor: a result is still produced, but it is
flagged `confidence: "lower"` on the gate's evidence entry and the gate returns **inconclusive** even
when no mutant survives — the protection is present, but nobody over-trusts the score. A lower-confidence
result is **not** rolled up into a module's `mutation_score`.

## Gate outcomes

| Situation                                        | Outcome (default)              |
| ------------------------------------------------ | ------------------------------ |
| No result / run skipped (fast lane, no changed code, tool not configured, suite not green) | **pass** (inert) |
| Every behaviour-changing mutant killed (mature)  | **pass**                       |
| Behaviour-changing mutant survived               | **inconclusive** (escalate)    |
| Lower-confidence language                         | **inconclusive**               |
| Working tree not clean after the run             | **fail** (safety)              |

- **Survivors escalate by default.** A project may opt into strict mode (`mutation_strict`) to turn
  surviving behaviour-changing mutants into a hard block. This avoids turning every survivor into a stop
  before baselines exist; ratcheting the score over time is owned by #110.
- The **fast lane** skips mutation entirely to stay light.

## Safety: always fully reverted

Planting and removing mutants must be fully reversed. The mature tools run mutants in their own sandbox;
the runner additionally **asserts the working tree is clean after the run** (`isTreeClean`). A dirty
tree is a hard failure — a mutant may have been left behind.

## Boundaries

- Flaky/non-deterministic tests that make the kill rate noisy → **#106 (flaky-test detection)**.
- Ratcheting the mutation score over time → **#110 (quality ratchet)**; this gate produces the signal.
- Acting on / triaging survivors → **#107 (triage findings)**.
