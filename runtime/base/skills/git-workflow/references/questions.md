# Starter questions for a new project

Each row is one `choice` in the `setup` output. The first option is recommended.

| Id                           | Question                                                                             | Options (first is recommended)                            | Sets                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `tickets.tracker`            | Where do your tickets live?                                                          | Jira; ServiceNow; GitHub Issues; No tickets               | `tickets.yaml` `sources` with that tracker's default pattern                              |
| `tickets.example`            | What does one of your ticket keys look like? (only asked when a tracker was picked)  | free text, for example `PROJ-123`                         | the source `pattern` built from the example: letters become `[A-Z]+`, digits become `\d+` |
| `pull_requests.extra_target` | Do changes also go to a shared test branch, like qa or staging, before they go live? | No; Yes: qa; Yes: staging                                 | `also_open_against`                                                                       |
| `branches.releases`          | Do you keep more than one released version going at the same time?                   | No, everything goes to main; Yes, release branches        | `base_branch: main` or `"release/*"`                                                      |
| `branches.hotfix`            | Do you need a separate path for urgent fixes?                                        | Yes; No                                                   | keeps or removes the `hotfix` type                                                        |
| `commits.template`           | How should a commit message start?                                                   | `PROJ-1: summary`; `feat(scope): summary`; `Summary only` | `commits.yaml` `template`; `pull-requests.yaml` `title_template` gets the same            |

Never propose a long-lived `develop` branch for a new project. Atlassian calls that model
legacy ([Atlassian](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow)).
