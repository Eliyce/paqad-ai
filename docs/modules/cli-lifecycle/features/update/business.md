# paqad-ai update — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `update`

## Overview

The day-one and day-N commands that bootstrap, refresh, and upgrade

This page describes **paqad-ai update** from a business / user-facing perspective.
The technical contract lives at [`technical.md`](./technical.md).

## User Roles

Document the personas that interact with `update`. For `cli-commands` modules this
typically means:

- **Developer / Operator** — runs the command directly in their terminal.
- **CI pipeline** — invokes the command non-interactively in a workflow runner.

## User Flows

Capture the main journeys for `update`. Each flow should call out:

- the trigger (CLI invocation, agent phrase, file event, schedule)
- the inputs the actor provides
- the artifacts produced (files written, registries updated, profile fields set)
- the success and failure observable signals

## Business Rules

- Enumerate invariants that must hold whenever `update` runs.
- Note any preconditions enforced upstream (e.g. onboarding must have run, a pack must be installed,
  a capability must be enabled).
- Spell out idempotency expectations — re-running should converge, not duplicate.
- Team settings move once from the old `.paqad/configs/.config.*` files and a hand-written
  feature-development workflow file to the YAML team files. `update` prints each setting it moved
  and asks the lead to review and commit the change in one go. Running it again changes nothing.
- Teammates and CI need the release that made the move, or later. The stub left in
  `.paqad/configs/.config.app` sets `paqad_enable=false` and `minimum_version` for an older
  paqad, so it turns itself off instead of quietly running on defaults. A 1.116.0 install stays
  off and never asks to update, because the off switch stops its hooks before the minimum version
  is read. `paqad-ai doctor` is the only place it says it is disabled, so a teammate on 1.116.0 has
  to update by hand. A current paqad ignores the stub.
- The move only goes forward. There is no command to go back to the old files; a bad release is
  fixed by the next one, with `PAQAD_DISABLED=1` on an affected machine in the meantime.
- `update` removes paqad's own old stage instructions and read paths from
  `feature-development/workflow.yaml` and prints one line for each. It removes only a line whose
  wording paqad once shipped for that stage, including `docs/modules/**` and
  `docs/instructions/**`. Only the line goes, never a file or folder, and anything paqad never
  shipped stays. A team that wants a removed line back should reword it, because the same wording
  is removed again on the next update and a reworded one stays. Commit the file so teammates don't
  repeat the change locally.
- A background update tells the next session what it changed. The update runs detached from
  session start, so the session that starts it works with changed files and hears nothing; the
  following session gets one line asking the agent to tell the developer. `paqad-ai update --last`
  shows the details at any time.
- The session line reaches Claude Code and Codex developers only for now. Other hosts start no
  background update, and a hand-run `update --silent` there leaves a record only `--last` reads.
- The pentest, site-map, design-test and codebase-health workflows now run from skills, so `update`
  removes their seven old rule files from a project when nobody edited them and says so. An edited
  file is never deleted: `update` keeps it and tells the team it can be deleted.

## Triggers & Side Effects

- Files written or updated under the project tree.
- Registries or trackers that get appended (e.g. `.paqad/doc-progress.json`,
  `.paqad/stack-snapshot.json`, `docs/instructions/registries/*`).
- Downstream workflows that this feature unblocks.

## Error States

- User-visible failures and the message contract.
- Recovery guidance — what the user should do, in plain language, when the feature aborts.

## Glossary

- Define terms a stakeholder might not know (e.g. *pack*, *capability*, *adapter*, *module map*).
