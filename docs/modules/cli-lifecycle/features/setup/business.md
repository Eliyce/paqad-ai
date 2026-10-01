# paqad-ai setup — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `setup`

## Overview

`paqad-ai setup` carries a created workspace from an undecided stack through official installation
to full onboarding (issue #596 Slice 3, SET). paqad **records and validates** a dependency-ordered
setup plan and **verifies readiness to develop** — it never runs the installers itself; official
installers, CLIs or connected tools do that (BND-04). The technical contract lives at
[`technical.md`](./technical.md).

## User Roles

- **Developer / Operator** — validates a setup plan, inspects step state, and checks readiness.
- **CI pipeline** — can gate on `paqad-ai setup verify` before treating a workspace as ready.

## User Flows

- **Validate a plan.** `paqad-ai setup plan validate <file>` checks a setup-plan record is a
  well-formed, dependency-ordered list of steps and rejects a malformed one with an actionable
  message.
- **Inspect progress.** `paqad-ai setup plan show` prints the stored plan's steps and their state.
- **Check readiness.** `paqad-ai setup verify` reports whether the project is ready to develop and,
  if not, names the blockers (an undecided stack is honestly reported as not-ready).

## Business Rules

- paqad records the official commands/tools to run and tracks each step's state
  (pending / in progress / blocked / completed); a missing tool is a recorded blocker, not a
  paqad-run install (SET-02, BND-04).
- The setup-plan record names the **slice** it belongs to and carries no "parent complete" field, so
  it can never imply the parent issue is done (INV-2).
- Readiness never claims ready for a workspace whose application stack is still undecided (FR-7).

## Triggers & Side Effects

- Reads/writes the setup-plan record at `.paqad/setup-plan.json`.
- Reads the project profile and `docs/modules/` to judge readiness; writes nothing during `verify`.

## Error States

- `SETUP_PLAN_NOT_FOUND` — no `.paqad/setup-plan.json` exists for the project root.
- `SETUP_STEP_UNKNOWN` — advancing a step id that is not in the plan.
- A malformed plan fails `setup plan validate` with the specific reason; `setup verify` exits
  non-zero when the project is not ready.

## Glossary

- **Setup plan** — a dependency-ordered record of the official steps (version, prerequisite,
  command, verification, recovery) needed to install the chosen stack.
- **Readiness to develop** — the applicable start/build/check commands are configured (a stack was
  chosen) and module documentation exists.
