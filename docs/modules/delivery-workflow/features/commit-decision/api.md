# Shipped Commits and the Commit Question: API View

> Module: **Delivery Workflow** (`delivery-workflow`) · Layer: `framework-internals` · Feature slug: `commit-decision`

## `paqad-ai delivery-link commit-decision <answer>`

```text
paqad-ai delivery-link commit-decision <commit|decline|ignored|user-requested>
                                       [--project-root <path>] [--session <id>]
```

- `commit`: the person said yes.
- `decline`: the person said no.
- `ignored`: no answer came, or the delivery policy is set never to ask (`ask_when_unspecified: false`).
- `user-requested`: the person asked for the commit, so no question was asked.

Output: `{"recorded":true,"feature":"<dir>","commit_decision":{...}}`, or
`{"recorded":false,"reason":"no feature to record on"}` when there is no change. An unknown
answer prints `unknown commit decision "<answer>"; expected one of commit, decline, ignored,
user-requested` on stderr and exits 1.

## Library surface

- `computeCommitSplit(projectRoot, { baseBranch?, startCommit?, ownTickets? }): CommitSplit`.
- `sharedBranchLine(split, branch): string | null` and
  `intakeBranchLine(projectRoot, ticketRefs): string | null`.
- `setCommitDecision(projectRoot, dirName, answer, recordedAt): DeliveryRecord`.
