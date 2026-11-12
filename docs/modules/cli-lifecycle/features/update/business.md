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
  paqad, so it turns itself off instead of quietly running on defaults, as the stub now says. A 1.116.0 install stays
  off and never asks to update, because the off switch stops its hooks before the minimum version
  is read. `paqad-ai doctor` is the only place it says it is disabled, so a teammate on 1.116.0 has
  to update by hand. A current paqad ignores the stub.
- Updates leave team files alone. `update` rewrites one only for a migration, a retired value, a
  removed setting or a stale workflow entry, and says so. A new setting no longer appears as a comment
  in team files: find it in `.paqad/.config.example` or with `paqad-ai config show`. Explicit writes,
  such as `paqad-ai config set`, still re-render the file they touch.
- The first update swaps `paqad_version` for `schema_version: 1` in all 17 team files, once. One person
  updates and commits the swap, then teammates update. Everyone needs this version or newer, and the
  plugin must be updated too, because inside a session the plugin's copy comes first on the PATH.
- To go back, revert the swap commit and install the older paqad.
- A project already on 1.119.0 keeps the duplicate comment in `commits.yaml` and doctor's changed-outside
  warning. After asking the team, the way out is `paqad-ai git-workflow check --accept`.
- Eleven settings that nothing read are removed, along with `feature-development/safety.yaml`. Update
  removes a live line once and says so. It keeps `safety.yaml` and says so if it holds notes your team wrote.
- When the hooks folder is tracked, or is husky's `.husky/_`, update gives the exact lines to add instead of changing it. With husky those go in `.husky/commit-msg` and `.husky/pre-push`. Lines an older paqad added to `.husky/_` never ran, don't count as installed, and a husky reinstall wipes them. The check
  is skipped in a terminal where `paqad-ai` isn't on the PATH, so someone with only the plugin who
  commits from a plain terminal gets no check.
- When the paqad discovery plugin is installed next to the paqad plugin, `update` adds one warning: both are
  named paqad, so Claude Code may run the hooks of only one and stage checks can stop. The fix is to
  remove paqad discovery, because the paqad plugin already has discover and ask. `paqad-ai doctor` reports
  the same thing.
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
