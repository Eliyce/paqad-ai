# paqad-ai onboard — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `onboard`

## Overview

The day-one and day-N commands that bootstrap, refresh, and upgrade

This page describes **paqad-ai onboard** from a business / user-facing perspective.
The technical contract lives at [`technical.md`](./technical.md).

## User Roles

Document the personas that interact with `onboard`. For `cli-commands` modules this
typically means:

- **Developer / Operator** — runs the command directly in their terminal.
- **CI pipeline** — invokes the command non-interactively in a workflow runner.

## User Flows

Capture the main journeys for `onboard`. Each flow should call out:

- the trigger (CLI invocation, agent phrase, file event, schedule)
- the inputs the actor provides
- the artifacts produced (files written, registries updated, profile fields set)
- the success and failure observable signals

## Business Rules

- The lead's RAG choice is committed in `.paqad/configs/.config.rag` so teammates inherit it; machine-local and environment overrides remain higher precedence.
- Re-running onboarding with the same semantic inputs leaves `.paqad/onboarding-manifest.json` byte-identical, including `generated_at` and the detection timestamp.
- Persisted signal and artifact paths are repository-relative, developer-local ignored noise is excluded, and order-insensitive path collections are sorted.
- Teammates use `paqad-ai join` after cloning instead of repeating onboarding.

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
