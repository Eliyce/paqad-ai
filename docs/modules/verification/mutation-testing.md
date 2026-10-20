# Mutation Testing — Verification Gate

> **Slug:** `mutation-testing` &nbsp;·&nbsp; **Gate:** `mutation-testing`

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
| Mode (floored)  | `src/mutation/mode.ts` (`resolveMutationMode`)         |
| Backstop seam   | `src/mutation/backstop.ts` (`runBackstopMutation`)     |

## When it runs

Mutation testing is **off by default** and opt-in. It is controlled by one floored knob, `mutation_mode`
(`off`, `warn` or `strict`, env `PAQAD_MUTATION_MODE`). The team value in `.paqad/configs/.config.*` is a
floor: a local `.paqad/.config` or the env var may raise it, never lower it.

The only caller of `runMutationGate` is repository verification
(`src/verification/repository/repository-context.ts`, through `runBackstopMutation`), and only on two
origins:

- **`ci-backstop` and `git-backstop`.** These fire only when the project calls
  `runtime/scripts/verify-backstop.mjs` from its own CI job or pre-push hook. paqad installs neither, so
  a project that never wires the backstop never runs mutation.
- **Never on `hook-completion`** (the end of an agent turn) and never on any per-edit seam, whatever the
  mode. There the gate reads not required: "Mutation testing runs only on CI and pre-push".

On a backstop origin with `warn` or `strict`, the step runs in this order:

1. The **project's own test command** (`commands.test` in `.paqad/project-profile.yaml`, the same command
   `paqad-ai checks` runs) runs first. That is the green-suite signal. No command reads did not run (no
   test command configured); a non-zero exit reads did not run (tests not green). In both cases the
   mutation tool never starts.
2. The **detected stack profile** of the project being verified (`stack_profile` in the project profile,
   or a read-only stack snapshot when the profile has none) picks the tool through `selectMutationTool`.
3. `runMutationGate` runs on the changed code files and its result lands on the verification context as
   `mutation_result`, with `mutation_strict` set when the mode is `strict`. The gate turns it into an
   outcome that flows through the existing verification evidence. There is no parallel store.

The project supplies the mutation tool for its stack. With none configured the gate reads did not run
and names the missing tool. A fault anywhere in the step records a `run-failed` skip; it never throws.

### Per host

| Host tier | Hosts | What mutation testing does |
| --------- | ----- | -------------------------- |
| Live, pre-edit and completion | Claude Code, Codex CLI | The end-of-turn check runs `hook-completion`, so mutation never runs there and the gate reads not required. A strict result blocks only through a backstop the project wired into its CI or pre-push hook |
| Live, completion only | Gemini CLI | The turn-end hook is record-only and runs `hook-completion`, so mutation never runs there and no mutation verdict appears in chat |
| Advisory | Cursor, Windsurf, Continue, GitHub Copilot, Junie, Aider, Antigravity, AI Assistant | No paqad hook runs, so paqad claims no mutation enforcement there |

The CI or pre-push backstop belongs to the project, not to the agent host, so its exit code is what
blocks a merge or a push under `strict`.

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
| No result (mutation off, or the end of an agent turn), or skipped on the fast lane or with no changed code | **not required** (never a pass) |
| Skipped because there is no test command, the suite was not green, the tool is not configured, or the run failed | **did not run**, naming the reason |
| Every behaviour-changing mutant killed (mature)  | **pass**                       |
| Behaviour-changing mutant survived               | **inconclusive** (escalate)    |
| Lower-confidence language                         | **inconclusive**               |
| Working tree not clean after the run             | **fail** (safety)              |

- **Survivors escalate under `warn`.** `mutation_mode=strict` sets `mutation_strict` on the context and
  turns surviving behaviour-changing mutants into a hard block. This avoids turning every survivor into a
  stop before baselines exist; ratcheting the score over time is owned by the quality ratchet.
- **Not required vs did not run.** Mode off, the end of an agent turn, the fast lane and a change with no
  code read not required. A missing or red test command, a missing tool and a failed run read did not
  run, with the reason in the detail. Neither is ever a pass.
- The **fast lane** skips mutation entirely to stay light.

## Safety: always fully reverted

Planting and removing mutants must be fully reversed. The mature tools run mutants in their own sandbox;
the runner additionally **asserts the working tree is clean after the run** (`isTreeClean`). A dirty
tree is a hard failure in both `warn` and `strict`: a mutant may have been left behind. At the backstop
seam "clean" means the run left the tree exactly as it found it (every dirty path and the digest of its
bytes match), so an uncommitted edit that was already there at pre-push is not blamed on the run.

## Why the code works the way it does

The reasons below are not obvious from the code in `src/mutation/`.

- **`scope.ts`.** Tests and docs are dropped with the change-evidence classifiers, then only files
  with a mutable source extension in the languages the adapter covers are kept. It does not reuse
  `isCodeFile`, whose rules are TypeScript-centred and would drop a Python or Rust file outside
  `src/`. Manifests, `tsconfig`, shell scripts, config, markup and lockfiles are left out because
  mutating them says nothing about behaviour. The list is sorted and de-duplicated so runs repeat.
- **`adapter.ts`.** Tools are matched by lower-cased stack tokens and the first match wins. A known
  language with weak tooling still records its language token but keeps the lower-confidence
  descriptor.
- **`runner.ts`.** Every outside effect is injected so the orchestration is tested without a real
  run. Stryker gets an explicit `--mutate` list and other tools take files as arguments, always only
  the changed files. The mutation command goes to the shell as one string so the quoting the command
  builder writes reaches the tool unchanged. A Node tool counts as configured when it is only a
  `package.json` dependency. Only Stryker's JSON report is parsed by default (its known locations
  are tried in order); other tools plug in their own parser, and an unreadable report is a skip.
- **`backstop.ts`.** Skips the runner would make anyway are decided before the suite runs, so the
  suite never runs for nothing. The project test command runs as an `&&` argv chain, the same way
  `paqad-ai checks` runs it, never through a shell.
- **`outcome.ts`.** A dirty tree wins over every other result, since a mutant may have been left
  behind. The maths is kept pure so the bar can be tested on its own.

## Boundaries

- Flaky/non-deterministic tests that make the kill rate noisy → **flaky-test detection**.
- Ratcheting the mutation score over time → **the quality ratchet**; this gate produces the signal.
- Acting on / triaging survivors → **finding triage**.
