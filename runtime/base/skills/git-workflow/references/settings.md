# Git workflow settings

verified: 2026-11-03

Every setting in `.paqad/configs/git-workflow/`. A team-named entry is a branch type or a
ticket source: its name is the team's own (`<name>` below), and `value: null` removes it.
Every other key can be changed but never removed. No personal override applies to these
files.

## `tickets.yaml`

| Key                                         | Type                                                               | Default                           | Meaning                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------- |
| `require_ticket`                            | boolean                                                            | `false`                           | Every change needs a ticket, and deliver stops without one.                           |
| `sources`                                   | map                                                                | `{}`                              | Where this team's tickets come from. No sources means the team works without tickets. |
| `sources.<name>.tracker`                    | `jira` \| `servicenow` \| `github-issues` \| `linear` \| `generic` | none                              | The tracker that holds this source's tickets.                                         |
| `sources.<name>.pattern`                    | regular expression                                                 | the tracker's default             | The ticket keys this source matches. `generic` needs one.                             |
| `sources.<name>.server`                     | string                                                             | `""`                              | The MCP server name. `""` means the first connected server of that tracker.           |
| `sources.<name>.transitions.on_pr_open`     | string                                                             | `""`                              | The status to move the ticket to when the PR opens. `""` means don't move it.         |
| `sources.<name>.transitions.on_ci_green`    | string                                                             | `""`                              | The status to move the ticket to when CI passes. `""` means don't move it.            |
| `write_back_refined`                        | `never` \| `ask` \| `always`                                       | `ask`                             | Write refined requirements back to the ticket. Not applied yet.                       |
| `intake_decisions.auto_resolve_from_priors` | boolean                                                            | `true`                            | Settle a ticket-intake decision from an earlier answer.                               |
| `intake_decisions.auto_resolve_from_rules`  | boolean                                                            | `true`                            | Settle a ticket-intake decision from a project rule.                                  |
| `intake_decisions.confirm_auto_resolutions` | `always` \| `batched` \| `never`                                   | `batched`                         | How settled decisions are confirmed.                                                  |
| `intake_decisions.max_options_per_packet`   | number                                                             | `4`                               | The most options one decision shows.                                                  |
| `intake_decisions.fingerprint_scope`        | list                                                               | `[ticket_type, module, category]` | What makes two decisions the same.                                                    |

## `branches.yaml`

| Key                         | Type           | Default                          | Meaning                                                                                                  |
| --------------------------- | -------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `base_branch`               | string or glob | the remote default branch        | The branch a change starts from and its PR goes back to. `"release/*"` means the newest matching branch. |
| `template`                  | template       | `{prefix}/{ticket}-{title_slug}` | How a branch name is built.                                                                              |
| `slug_max_length`           | number         | `50`                             | The longest `{title_slug}`.                                                                              |
| `types`                     | map            | `feature`, `bugfix`, `hotfix`    | The kinds of change this team makes.                                                                     |
| `types.<name>.prefix`       | string         | the type's name                  | The branch prefix.                                                                                       |
| `types.<name>.commit_type`  | string         | the type's name                  | The value of `{type}` in commit and PR templates.                                                        |
| `types.<name>.tickets`      | list           | any                              | Which ticket sources this type uses.                                                                     |
| `types.<name>.ticket_types` | list           | none                             | Tracker issue types that mean this type, like Bug.                                                       |
| `types.<name>.base_branch`  | string or glob | `base_branch`                    | Overrides `base_branch` for this type.                                                                   |
| `types.<name>.labels`       | list           | none                             | PR labels added for this type.                                                                           |
| `types.<name>.template`     | template       | `template`                       | Overrides `template` for this type.                                                                      |
| `default_type`              | string         | `feature`                        | The type used when nothing else decides it.                                                              |

## `commits.yaml`

| Key                    | Type              | Default               | Meaning                                                                        |
| ---------------------- | ----------------- | --------------------- | ------------------------------------------------------------------------------ |
| `template`             | template          | `{ticket}: {summary}` | How a commit message is written.                                               |
| `sign_off`             | boolean           | `false`               | Adds a Signed-off-by line (git commit -s).                                     |
| `ask_when_unspecified` | boolean           | `true`                | Ask once at the end of a change whether to commit, and record the answer.      |
| `summary.style`        | `plain` \| `free` | `plain`               | `plain` checks that the summary is written for a person who doesn't read code. |
| `summary.max_length`   | number            | `72`                  | The longest summary.                                                           |

## `pull-requests.yaml`

| Key                  | Type                                     | Default                       | Meaning                                                           |
| -------------------- | ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `host`               | `github`                                 | `github`                      | Where PRs are opened. Only GitHub for now.                        |
| `host_server`        | string                                   | `""`                          | The MCP server for the host.                                      |
| `title_template`     | template                                 | `{ticket}: {summary}`         | How a PR title is written.                                        |
| `body_template`      | path                                     | `.paqad/templates/pr-body.md` | The team's PR template.                                           |
| `draft`              | boolean                                  | `false`                       | Open every PR as a draft.                                         |
| `reviewers`          | list                                     | none                          | Reviewers added to every PR.                                      |
| `labels`             | list                                     | none                          | Labels added to every PR. Type labels are added on top.           |
| `link_ticket`        | boolean                                  | `true`                        | Add the ticket to the PR body.                                    |
| `also_open_against`  | list                                     | none                          | Extra branches that get the same change as their own PR, like qa. |
| `ci.gate`            | `wait_for_green` \| `warn_only` \| `off` | `wait_for_green`              | Whether deliver waits for CI.                                     |
| `ci.timeout_minutes` | number                                   | `30`                          | How long deliver waits for CI.                                    |
| `ci.on_red`          | `stop` \| `comment_and_stop`             | `stop`                        | What deliver does when CI fails.                                  |

## `enforcement.yaml`

| Key       | Type                       | Default | Meaning                                                                                                                 |
| --------- | -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `enabled` | boolean                    | `true`  | `false` turns off paqad's delivery help and checks completely.                                                          |
| `agents`  | `block` \| `warn`          | `block` | How strictly work done through a coding agent is held to the rules.                                                     |
| `people`  | `block` \| `warn` \| `off` | `warn`  | How strictly people's commits and pushes are held to the rules by git hooks. `git commit --no-verify` still skips them. |

## `design-sign-off.yaml`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Post a high-level design for sign-off after the spec is frozen. |
| `lanes` | list | `[graduated, full]` | The lanes that need sign-off. |
| `approval_channel.server` / `.channel` | string | `""` | Where to post. Empty means the change's tracker. |
| `format.summary_max_words` / `.detail_max_words` | number | `200` / `800` | Word limits for the design. |
| `wait_for_approval` | boolean | `true` | Hold the first code edit until sign-off. |
| `approve_by` | `reply` \| `status` \| `either` | `either` | What counts as sign-off. |
| `approve_words` | list | `[approved, lgtm, "sign off"]` | Words in a reply that approve. |
| `approvers` | list | none | Who may approve. Empty means anyone except the developer. |
| `move_to_on_post` | string | `""` | Status the ticket moves to when the design is posted. |
| `approved_status` | string | `""` | A ticket status that counts as approval. |
| `allow_skip_with_reason` | boolean | `true` | Allow building before sign-off with a stated reason. |

Templates use these placeholders: `{prefix}`, `{type}`, `{ticket}`, `{title}`,
`{title_slug}`, `{summary}`, `{scope}` and `{tech_debt}`.
