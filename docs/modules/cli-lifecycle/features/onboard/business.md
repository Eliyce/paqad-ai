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

- The lead's RAG choice is committed in `.paqad/configs/retrieval.yaml` so teammates inherit it; machine-local and environment overrides remain higher precedence.
- Team settings live in readable YAML files under `.paqad/configs/`. Onboarding creates each one with only a header; a team adds a line only for what it changes. If the project still has the old `.paqad/configs/.config.*` files or a hand-written feature-development workflow file, onboarding moves their settings to the YAML files and prints what it moved, so the lead can review and commit it in one go.
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

## The onboarding journey

In an AI tool, "onboard paqad" (or the `/paqad onboard` tray in Claude Code) runs the whole setup
as one journey. The person answers one question: which AI tools the team uses (Claude Code ticked)
and whether to let it work without stopping to ask (ticked). Then eight steps run in order, none
skipped: Read your project, Set up paqad, Write the project docs, Write the module docs, Research
rules for your stack, Check which rules can be automated, Write the rule checks, Wrap up.

- No questions in between: every pause takes its recommended answer and is written to
  `.paqad/onboarding/choices.jsonl`. Those answers are not reused as "same as last time" until a
  person marks them reviewed with `paqad-ai onboarding choices --review`.
- Step 3 only adds project doc pages that are missing. Existing pages stay byte-identical and are
  listed for review in the report. Existing rules are never changed or removed; suggested changes
  are listed for review.
- Rule checks for rules the journey added only warn until a person reviews them, so a first
  onboarding never turns CI red.
- A stop keeps progress: resume starts again at the first unfinished unit of the step that stopped.
  Another ticked AI tool may resume the journey; that is recorded as a hand-over.
- Only these gaps let the next step start: research run offline, research stopped before all
  packages, git workflow kept, stack mismatch noted and search index off.
- At the end the person sees a summary and one question, "Commit these changes on a new branch?",
  which is never answered automatically. Declining leaves the files uncommitted.
- The local allow list in `.claude/settings.local.json` stays after onboarding; the report says how
  to remove it.
- A plain terminal `paqad-ai onboard` behaves as before and, after a first onboarding, prints one
  line pointing to "onboard paqad" in the ticked AI tools that have skills. When a journey is open
  it points to resume instead. AI tools without skills (Aider, Copilot, Junie, AI Assistant) are
  unchanged.
