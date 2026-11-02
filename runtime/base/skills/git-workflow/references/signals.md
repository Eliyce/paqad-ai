# History signals

`propose.mjs` reads these. A signal the account can't see goes into `unknown` and is never
reported as "none".

| Signal                               | Read from                                                     | When it can't be read                        |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------- |
| Remote and host                      | `git remote get-url origin`                                   | no remote: `mode: new-project`               |
| Default branch                       | `git symbolic-ref --short refs/remotes/origin/HEAD`           | falls back to `main`                         |
| Branch names                         | `git branch -r`                                               | none                                         |
| Main-line commit subjects and bodies | `git log --first-parent -n 200 origin/HEAD`                   | none                                         |
| PR history                           | `gh pr list --state all --limit 200`                          | `unknown` line, PR-based values skipped      |
| Allowed merge methods                | `gh repo view`                                                | `unknown` line                               |
| Rules on the base branch             | `gh api repos/{owner}/{repo}/rules/branches/{base}`           | 403 or 404: `unknown` line, never "no rules" |
| CI target branches                   | `pull_request:` `branches:` in `.github/workflows/*.yml`      | none                                         |
| Code owners                          | `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`         | none                                         |
| PR template                          | `.github/pull_request_template.md` and the other usual places | `.paqad/templates/pr-body.md`                |

## Thresholds

- **Decide or ask.** One option with 70% or more of the evidence is decided without
  asking. Otherwise it becomes a `choice` with the top three options, the most common
  recommended.
- **New project.** No remote, fewer than 20 main-line commits, or no branches except the
  base.
- **Commit style** comes from main-line subjects and PR titles only. Branch-only commits
  are ignored, because with squash merges the message that lands is written at merge time.
- **Base branch.** `release/*` when release branches get 50% or more of typed PRs;
  otherwise the most common PR base; without `gh`, the remote default branch.
- **Extra PR targets.** A second base that got the same head branch in 30% or more of
  cases becomes an `also_open_against` choice, recommended "no".
- **Branch types.** A first path segment used by 5% or more of the branches (leaving out
  bases, `HEAD`, `release`, `dependabot`, `renovate` and `revert-*`) becomes a type.
  `feature` maps to `feat`; `bugfix`, `bug`, `fix` and `hotfix` map to `fix`.
- **Ticket sources.** A key prefix with 5 or more hits becomes a source (Jira or Linear is
  asked). 5 or more ServiceNow keys make a `servicenow` source; 5 or more subjects naming a GitHub issue
  make a `github-issues` source.
- **Labels.** 60% or more of a type's PRs puts a label on that type; 80% or more of all
  PRs puts it on every PR.
- **Draft.** 50% or more drafts sets `draft: true`.
- **Sign-off.** 50% or more `Signed-off-by:` bodies sets `sign_off: true`.
- **Enforcement** always starts at `agents: block` and `people: warn`.
