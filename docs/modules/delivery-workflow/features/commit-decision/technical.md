# Shipped Commits and the Commit Question: Technical View

> Module: **Delivery Workflow** (`delivery-workflow`) · Layer: `framework-internals` · Feature slug: `commit-decision`

## Module Boundaries

- `src/delivery/commit-split.ts`: `computeCommitSplit`, `changeOwnTickets`,
  `branchCarriesOtherWork`, `describeInherited`, `sharedBranchLine`, `intakeBranchLine`.
- `src/feature-evidence/delivery.ts`: the `delivery.json` record (`start_commit`,
  `commit_split`, `commit_decision`, `push`, `pr`, `ci`), `seedFeatureDelivery`,
  `refreshCommitSplit`, `setCommitDecision`.
- `src/cli/commands/delivery-link.ts`: `paqad-ai delivery-link commit-decision`.

## Data Model

```text
start_commit: string | null
commit_split: {
  state: "known" | "unknown",
  reason: string | null,
  base_commit: string | null,
  own:       { count, tickets[], merges, untagged } | null,
  inherited: { count, tickets[], merges, untagged } | null
}
commit_decision: { asked: boolean, answer: "commit" | "decline" | "ignored" | "user-requested" | null, recorded_at: string | null }
```

## Behaviour

- **Start commit.** The first seed of a change's `delivery.json` keeps the HEAD it started from;
  later seeds never overwrite it.
- **Own tickets.** Ticket references in the change's issue, else in its branch name.
- **Split.** Each commit in `base..HEAD` is read with its parents and the ticket refs in its
  subject. A commit is the change's own when it names one of the own tickets, or when it names no
  other ticket and was made after the start commit. Every other commit is inherited, counted with
  its foreign tickets, merges and untagged commits.
- **Warning.** `branchCarriesOtherWork` is true when the split is known and an inherited commit
  names another ticket. Untagged commits from before the start are still counted as inherited
  and untagged in the split, but on their own they raise no warning: they are usually the
  developer's own earlier work. `describeInherited` counts the other-ticket commits and adds the
  untagged ones separately ("3 commits from 2 other tickets and 1 untagged made before this
  change started"). `sharedBranchLine` renders the one warning line used at intake, on the HUD and on the open-PR
  question.
- **Commit decision.** `setCommitDecision` writes `{ asked: answer !== "user-requested", answer,
  recorded_at }`. The target change is the session's active change, else the change matched by the
  current branch.
