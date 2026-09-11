---
name: test-runner-discovery
description: When no script can classify how a project's test runner parallelizes, read the manifests and lockfiles, decide whether a parallel mode exists and its prerequisite is installed, and emit a validated JSON record for `paqad-ai checks record-runner`. Issue #554, Part B.5. The deterministic guard is the `checks record-runner` verb (src/checks/record-runner.ts), which validates the result against an argv allowlist and never trusts it.
model_tier: fast
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  project_root:
    type: path
    required: true
    description: The project whose test runner is being classified.
  test_command:
    type: string
    required: true
    description: The project's mapped `commands.test` — the parallel command must build on it.
---

## What It Does

Decides how the project's own test runner parallelizes when paqad's script detection could not
(`checks plan` printed `test: sequential (unknown)`). It reads the project's manifests and lockfiles,
identifies the runner the project's test script invokes, and decides whether a parallel mode exists
**and its prerequisite is installed** — never assuming, never installing anything. It emits a small
JSON record; the `paqad-ai checks record-runner` verb validates and stores it.

## Use This When

- A feature-development `checks run` reported `test ran sequentially: parallel mode unknown`, and you
  want the next run to be fast. Run this once; the recorded decision makes every later run fast.

Do **not** run this when `checks plan` already shows `parallel`, `native`, or a concrete
`sequential (<reason>)` — the script has already decided.

## Inputs

- `project_root` — the project to inspect.
- `test_command` — the project's `commands.test`; the parallel command MUST start with its runner
  invocation and only add allowlisted parallel flags.
- Read `references/allowed-flags.md` for the exact tokens a `test_parallel` may add.

## Procedure

1. Read the ecosystem manifest and lockfile: `composer.json`/`composer.lock`, `package.json` and its
   lockfile, `pyproject.toml`/`requirements*.txt`/`poetry.lock`/`uv.lock`, `Gemfile.lock`,
   `build.gradle(.kts)`, `go.mod`, `Cargo.toml`, `pubspec.yaml`.
2. Identify the runner the project's own test script invokes (mocha, tap, ava, …).
3. Decide whether a parallel mode exists AND its prerequisite is present in the lockfile. If the
   prerequisite is missing, the mode is `unavailable` — never propose installing it.
4. When `available`, build `test_parallel` from `test_command` by adding only tokens listed in
   `references/allowed-flags.md`, with `<processes>` exactly once. Never add any other token.
5. Write `<scratch>/test-runner.json` (see Output Contract) and hand it to the pipeline:
   `npx paqad-ai checks record-runner <scratch>/test-runner.json`. That verb runs the deterministic
   guard and rejects anything outside the allowlist — do not re-implement that check here.

## Output Contract

A JSON object with exactly these keys:

```json
{
  "schema_version": 1,
  "runner_id": "mocha",
  "parallel": "available",
  "reason": null,
  "test_parallel": "pnpm test -- --parallel --jobs=<processes>",
  "single_test_selector": "file",
  "evidence": ["package.json", "pnpm-lock.yaml"]
}
```

- `parallel` is one of `available`, `unavailable`, `native`.
- `test_parallel` is required when `available`, and must start with the project's own runner
  invocation, then add only allowlisted tokens with `<processes>` exactly once.
- `reason` is a short sentence when `unavailable`/`unknown`, else `null`.
- `evidence` is a non-empty list of files you read that exist under the project.

## Escalate / Stop Conditions

- Emit `parallel: "unavailable"` with a plain `reason` when no parallel mode exists or its
  prerequisite is missing. Never propose installing a package.
- Never add a token outside `references/allowed-flags.md`; the record verb rejects it and nothing is
  stored.

## Resources

- `references/allowed-flags.md` — the exact argv tokens a `test_parallel` may add.
- `agents/openai.yaml` — the agent interface metadata.
