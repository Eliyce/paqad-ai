# Archetype Resolution — Business View

> Module: **Stack Detection Engine** (`stack-detection-engine`) · Layer: `framework-internals` · Feature slug: `archetype-resolution`

## Overview

Lockfile-first detection of frameworks, traits, and archetypes across

This page describes **Archetype Resolution** from a business / user-facing perspective.
The technical contract lives at [`technical.md`](./technical.md).

## User Roles

Document the personas that interact with `archetype-resolution`. For `framework-internals` modules this
typically means:

- **paqad-ai contributor** — reads this page to understand how the engine works.
- **Downstream module** — depends on this engine's public contract.

## User Flows

Capture the main journeys for `archetype-resolution`. Each flow should call out:

- the trigger (CLI invocation, agent phrase, file event, schedule)
- the inputs the actor provides
- the artifacts produced (files written, registries updated, profile fields set)
- the success and failure observable signals

## Business Rules

- Enumerate invariants that must hold whenever `archetype-resolution` runs.
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
