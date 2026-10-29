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

## `paqad-ai delivery-link refresh`

```text
paqad-ai delivery-link refresh [--project-root <path>] [--session <id>] [--min-age-seconds <n>]
```

Reads push, pull request and CI for the change whose branch is checked out, through `git` and
`gh pr view`, and saves them in that change's `delivery.json`. It only reads git and GitHub: it
never pushes, comments, re-runs CI, seeds, commits or merges. It always exits 0 and prints one
line:

```json
{"refreshed":true,"feature":"<dir>","reason":null,"push":"pushed","ci":{"state":"pending","done":1,"total":2}}
```

`refreshed` is false, with nothing written, and `reason` one of `delivery policy is off`,
`no branch` or `no change on this branch`. With `--min-age-seconds n` and a stored reading
younger than `n` seconds it is false with `reason` `fresh` and gh is not called. When gh fails it
is false, `reason` is the fixed phrase (`gh is not installed`, `gh is signed out`,
`gh timed out after 10 s`, `gh is rate-limited`, `gh returned unreadable output`,
`no pull request for this branch` or `gh could not read the pull request`), the stored `pr` and
`ci` stay as they were and only `ci_read` changes. The HUD runs it while an open PR's CI is
pending; `delivery-link` is a HUD refresh verb, so the snapshot for `--session` is rewritten after.

## Library surface

- `refreshDelivery({ projectRoot, run, now?, minAgeSeconds? }): Promise<DeliveryRefreshOutcome>`.
- `saveDeliveryReading(projectRoot, result, now?, { startedAt?, keepOnGhFailure? }): void`.

- `computeCommitSplit(projectRoot, { baseBranch?, startCommit?, ownTickets? }): CommitSplit`.
- `sharedBranchLine(split, branch): string | null` and
  `intakeBranchLine(projectRoot, ticketRefs): string | null`.
- `setCommitDecision(projectRoot, dirName, answer, recordedAt): DeliveryRecord`.
