# Tech Debt: Business View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `tech-debt`

## Overview

While a change is built, the agent and its reviewers find problems that do not belong to that
change: a bug next door, a missing test, a follow-up idea. Fixing them on the spot widens the
change; dropping them loses them. `paqad-ai debt` gives each one a home instead. It writes one
`TD-<ULID>` file per finding under `docs/instructions/tech-debt/`, lists the open ones on the
overview page, ties each to the change that found it, and puts them on the receipt, the HUD and
the PR, so they are seen and can be turned into real issues later.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md).

## User Roles

- **Developer**: sees what the change found but did not fix, on the receipt and in the PR, and
  decides which items become issues.
- **Agent (review and documentation stages)**: records an out-of-scope finding with
  `paqad-ai debt add` instead of fixing it inside the change or leaving it unsaid.
- **Team lead**: reads the open list on `docs/instructions/tech-debt/overview.md` and promotes or
  closes items.

## User Flows

- **Record a finding.** `paqad-ai debt add --title ... --kind ... --severity ...` writes a new
  item, or answers that the same finding is already recorded, or reopens it when it was closed.
- **Review.** A review finding the reviewer marks out of scope is routed to `debt add`, and the
  finding keeps the item id in `deferred_to`.
- **See it.** The receipt counts the items the change raised, the HUD shows them, and the PR body
  gains a "Tech debt found in this change" section.
- **Follow up.** `paqad-ai debt promote <id> --issue <ref>` records the issue the item became;
  `paqad-ai debt close <id> --reason <why>` closes it with the reason.

## Business Rules

- One finding is one item. The same title (case and spacing ignored) about the same files is
  never recorded twice; a closed match is reopened instead.
- Every item says which change, issue and stage found it, and who found it (default
  `orchestrator`).
- The overview page lists open items only, newest first, between paqad's markers; the text around
  the markers is the team's and is never touched.
- Items are plain markdown in the repo, so they travel with the code and need no service.

## Triggers and Side Effects

- Writes `docs/instructions/tech-debt/TD-<ULID>.md` and rewrites the marked block on
  `docs/instructions/tech-debt/overview.md`.
- Rewrites the active change's `tech-debt.json` in its evidence bundle.
- Editing these files does not make the agent reload the framework: the entry check skips
  `docs/instructions/tech-debt/`.

## Error States

- A wrong `--kind`, `--severity` or `--status`, an empty title, issue or reason, a file outside
  the project, or an unknown id: the command prints why and exits 1. Nothing is written.

## Glossary

- *tech-debt item*: one recorded finding, `TD-<ULID>.md`, with status `open`, `promoted` or
  `closed`.
- *out of scope*: a real problem that this change is not asked to fix.
