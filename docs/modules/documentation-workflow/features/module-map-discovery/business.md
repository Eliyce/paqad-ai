# Module Map Discovery — Business View

> Module: **Documentation Workflow** (`documentation-workflow`) · Layer: `agent-workflows` · Feature slug: `module-map-discovery`

## Overview

The two-stage flow triggered by "create documentation" (Stage 1 —

This page describes **Module Map Discovery** from a business / user-facing perspective.
The technical contract lives at [`technical.md`](./technical.md).

## User Roles

Document the personas that interact with `module-map-discovery`. For `agent-workflows` modules this
typically means:

- **LLM coding agent** (Claude Code, Codex, Cursor, Copilot, …) — invokes the workflow when the user types the trigger phrase.
- **Developer guiding the agent** — supplies the prompt and reviews the output.

## User Flows

Capture the main journeys for `module-map-discovery`. Each flow should call out:

- the trigger (CLI invocation, agent phrase, file event, schedule)
- the inputs the actor provides
- the artifacts produced (files written, registries updated, profile fields set)
- the success and failure observable signals

## Business Rules

- Enumerate invariants that must hold whenever `module-map-discovery` runs.
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

## Glossary

- Define terms a stakeholder might not know (e.g. *pack*, *capability*, *adapter*, *module map*).
