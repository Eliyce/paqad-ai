# Claude Code (CLAUDE.md) — Business View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `claude-code`

## Overview

Generates the thin entry file each external LLM agent platform reads on

This page describes **Claude Code (CLAUDE.md)** from a business / user-facing perspective.
The technical contract lives at [`technical.md`](./technical.md).

## User Roles

Document the personas that interact with `claude-code`. For `cli-commands` modules this
typically means:

- **Developer / Operator** — runs the command directly in their terminal.
- **CI pipeline** — invokes the command non-interactively in a workflow runner.

## User Flows

Capture the main journeys for `claude-code`. Each flow should call out:

- the trigger (CLI invocation, agent phrase, file event, schedule)
- the inputs the actor provides
- the artifacts produced (files written, registries updated, profile fields set)
- the success and failure observable signals

## Business Rules

- Enumerate invariants that must hold whenever `claude-code` runs.
- Note any preconditions enforced upstream (e.g. onboarding must have run, a pack must be installed,
  a capability must be enabled).
- Spell out idempotency expectations — re-running should converge, not duplicate.

## Triggers & Side Effects

- Files written or updated under the project tree.
- Registries or trackers that get appended (e.g. `.paqad/doc-progress.json`,
  `.paqad/stack-snapshot.json`, `docs/instructions/registries/*`).
- Downstream workflows that this feature unblocks.

## Error States

- User-visible failures and the message contract.
- Recovery guidance — what the user should do, in plain language, when the feature aborts.

## The HUD in Claude Code

The paqad plugin draws a band above the prompt that shows the change this session is working on.

- **Only your change, right now.** The band shows a change only while you are on the feature
  development route, on that change's branch, and this session has worked on it since the route
  started. Otherwise it says `no change in progress`. An old change on another branch, or a
  question you asked, never fills the band with someone else's story.
- **Three instruments.** STAGE shows where the change is, HIGH TABLE shows the experts while they
  write and rule, and SHIP shows Edit, Commit, Push, PR, CI and Merge. Merge lights only when your
  own pull request is merged; paqad never merges. Commits already on the branch before the change
  started are shown as not yours.
- **Honest numbers.** A verdict shows only when it was written for this change after its latest
  edit. Gates read not judged yet until the stage that judges them has ended. Cost counts only the
  turns spent on this change, or says whole session when it cannot split them.
- **Other workflows.** A question, a health check or any other workflow gets one line under the
  prompt with its own tokens and cost, and a running clock while it works.
- **Out of the way when you want.** Minimise the band to one line, close it for this session or
  hide it in this project. `/paqad show` brings it back. If a decision waits while it is out of
  the way, the line turns amber and reads Needs you; the question is still asked in chat.
- **The paqad Ledger.** Pressing paqad, Proof or any instrument opens the Ledger beside the chat:
  Trust, High Table, Ships, Record and Cost, starting on Trust. It opens on its own once per change.

## Glossary

- Define terms a stakeholder might not know (e.g. *pack*, *capability*, *adapter*, *module map*).
