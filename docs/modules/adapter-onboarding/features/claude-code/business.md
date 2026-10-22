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
  started. Until then it draws nothing. An old change on another branch, or a question you asked,
  never fills the band with someone else's story.
- **Needs you means you.** The band asks for you only while a question is on screen, a permission
  prompt waits for you, or a decision is pending. A rule that stopped an edit is Claude's to fix,
  so it never asks for you; it stays in the Ledger's Trust tab as history. Coral means waiting on
  you; amber marks something that needs a look, such as a flag or a marked stage.
- **It always binds.** The band draws even when another plugin already owns `/paqad`. Then the HUD
  command is `/paqad-hud`, and every hint names the command that works. If paqad cannot read this
  session's record, the band says so in coral instead of looking idle.
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
  hide it in this project. `/paqad hide` hides it from the prompt, and `/paqad show` brings it
  back. If something waits on you while it is out of the way, the line reads Needs you; the
  question is still asked in chat.
- **The paqad Ledger.** It opens beside the chat on Trust, with Trust, High Table, Delivery,
  Record and Cost. On the terminal, pressing paqad, Proof or any instrument opens it. On Desktop,
  the Ledger button and the flags open it. It opens on its own once per change. `/paqad ships`
  and `/paqad delivery` both print the Delivery view.
- **Desktop has its own band.** In the Claude Code Desktop app the band is a card: who is working
  and what it costs, one line that says what is happening, and a strip that draws the stages, the
  High Table and the delivery steps that apply to this change. A live state has a light that
  breathes and a running clock; a settled one stays still. The close button asks inline: close for
  now, hide always, or cancel.
- **The task list follows the stages.** On a feature change, each prompt reminds Claude of the
  lane's stage list (Plan, Spec, Load rules, Build, Review, Checks, Docs; on the fast lane Plan,
  Build, Checks). A task list that leaves them out is turned back once per turn with the same
  sentence.

## Glossary

- Define terms a stakeholder might not know (e.g. *pack*, *capability*, *adapter*, *module map*).
