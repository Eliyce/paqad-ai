# Shipped Commits and the Commit Question: Business View

> Module: **Delivery Workflow** (`delivery-workflow`) · Layer: `framework-internals` · Feature slug: `commit-decision`

## Overview

A PR ships every commit on its branch, not only the ones the change made. When a branch already
carries work from other tickets, that work rides along silently. The change's `delivery.json` now
says what really ships: the commit the change started from, the change's own commits, the
commits riding along from other work, and the push, PR and CI that went with it. paqad warns when
a branch carries other tickets' commits, at intake, on the HUD and on the open-PR question. It
also records how the commit question was answered, with `paqad-ai delivery-link
commit-decision`.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md).

## User Roles

- **Developer**: sees before opening a PR that other commits will ship with it, and decides
  whether to split the branch.
- **Reviewer**: reads on the HUD's Ships tab which commits belong to the change.
- **Agent**: records the answer to "commit this?" so the record shows whether it was asked.

## User Flows

- **Intake.** When a change starts on a branch that already carries other tickets' commits,
  intake shows one line: "Branch `<branch>` already carries N commits from M other tickets. They
  ride along in this PR unless you split the branch yourself; paqad never moves commits."
- **Commit question.** After asking the person whether to commit, the agent runs `paqad-ai
  delivery-link commit-decision <commit|decline|ignored>` (`ignored` when no answer came). When the person asked for the commit
  themselves, it records `user-requested`.
- **Ship.** The Ships tab shows own against inherited commits, the push, the PR and CI.

## Business Rules

- paqad never moves, drops or rewrites commits. It only reports what will ship.
- When git cannot answer (not a repo, a detached HEAD, no reachable base branch), the split reads
  "unknown" with the reason, never a guess.
- `user-requested` means the person asked, so the record says the question was not asked.

## Triggers and Side Effects

- Writes `commit_decision` on the change's `delivery.json` and regenerates the feature report when
  it is on.

## Error States

- An answer outside the four values: exit 1 with the allowed values.
- No change to record on: prints `{"recorded":false,"reason":"no feature to record on"}`, exit 0.
