---
name: git-workflow
description: Sets up and changes this team's git workflow rules in .paqad/configs/git-workflow/ (ticket sources and key patterns, branch types and naming, base branches, commit message format, PR title, body, labels and reviewers, ticket status moves, and how strictly agents and people are held to them) through scripts that read git and gh, propose with evidence, validate and write, and it records every answer as a decision. Use when create documentation reaches its git workflow step, when a new project needs its starter rules, and whenever someone asks to change how branches, commits, PRs or tickets work, even if they don't mention the config. It is the only way these files change.
metadata:
  model_tier: medium
  cacheable: 'false'
  output_format: markdown
  max_lines: '300'
  paqad-meta: skill.meta.yaml
---

## Rules

- Change .paqad/configs/git-workflow/ only through this skill's scripts. Never edit those files with Edit, Write or a shell command: paqad blocks direct edits, and a change that skips the scripts is never checked or recorded.
- Base every proposal on what the scripts found. When history is mixed, ask the team; don't pick for them. When something can't be read, say it's unknown, never that it doesn't exist.
- Record every answer as a decision, so the team can see later why each rule exists.

## What It Does

One skill is in charge of `.paqad/configs/git-workflow/`, the six files that hold this
team's rules for tickets, branches, commits, pull requests and how strictly they're
checked (`tickets.yaml`, `branches.yaml`, `commits.yaml`, `pull-requests.yaml`,
`enforcement.yaml`, `design-sign-off.yaml`). It handles three cases:

- **first setup** from the repo's history, during `create documentation`
- **a new project** with no history
- **any later change** the team asks for

The scripts read git and `gh`, propose with evidence, validate and write. Your job is
only to ask the team and explain.

## Use This When

- `create documentation` reaches its git workflow step (first setup).
- The repo has no remote, fewer than 20 main-line commits, or no branches besides the
  base (the scripts report `mode: new-project`).
- Someone asks to change how branches are named, where changes start, how commits or
  PR titles are written, which labels or reviewers a PR gets, which tickets a change
  links, how ticket statuses move, or how strictly any of that is checked. This applies
  whatever workflow the request routed to, and even when the request doesn't mention
  the config.

## Inputs

- `project_root` (path, optional): defaults to cwd.
- `flow` (string, optional): `first-setup`, `new-project` or `change`. Picked from the
  request when not given.

## Procedure

Every script prints JSON on stdout, never prompts, and exits 0 on success, 1 on invalid
input or config, and 2 when git or `gh` failed.

### First setup

- [ ] 1. Run `scripts/check.mjs`. If it reports errors or `changed_outside`, show them and stop until the team says how to handle them.
- [ ] 2. Run `scripts/propose.mjs`. If `mode` is `new-project`, switch to the new-project procedure.
- [ ] 3. Show the team a short summary: one line for each evidence item that decided a value, plus every `unknown` line.
- [ ] 4. Ask every `choice` in one round with your host's question tool. Use up to 4 questions per call, back to back. Put the recommended option first, and put the evidence counts and examples in each option's preview.
- [ ] 5. For each answered choice, record a decision:
  - `paqad-ai decision create --category workflow-or-tool --title "<question>" --context "<evidence lines>" --option <id>=<label> ... --recommendation <recommended>`
  - then `paqad-ai decision resolve <id> <chosen> "<the team's reason>"`
- [ ] 6. Write the answers to a temporary `answers.json` outside the repo, starting from `assets/answers.template.json`. Run `scripts/apply.mjs <answers.json> --overwrite --dry-run` and show the diff. Then run it again without `--dry-run`.
- [ ] 7. Report using `assets/final-message.txt`: the files written, each choice and its answer, anything `not confirmed`, and the `unknown` lines. The files and the resolved decisions ship with the documentation change.

### New project

The same steps 1 to 7. `propose` returns the starter questions from
`references/questions.md` as its choices, and the package defaults as its files. Never
propose a long-lived `develop` branch for a new project.

### Change

- [ ] 1. Run `scripts/check.mjs`. The same rule as step 1 above applies.
- [ ] 2. Turn the request into `change.json` edits, starting from `assets/change.template.json`. Use only settings listed in `references/settings.md`. If the request is unclear, ask one question first.
- [ ] 3. Run `scripts/change.mjs --plan <change.json>`. Explain the diff in plain words, for example: "Hotfix branches will start from main and use ServiceNow tickets."
- [ ] 4. Ask the team to confirm with your host's question tool. Record the answer as a decision, as in step 5 above.
- [ ] 5. Run `scripts/change.mjs --apply <change.json>`.
- [ ] 6. Ship it like any change, so the team reviews it as a PR: `paqad-ai deliver` on its own branch, with the resolved decision committed. Use the branch type `chore` if the team has one; otherwise its `default_type`.

In `change.json`, `value: null` removes a branch type or a ticket source. It is an error
for any other key, because settings are never removed.

## Output Contract

- The six files under `.paqad/configs/git-workflow/`, valid, written only by the
  scripts, and stamped in `.paqad/configs/git-workflow/.last-applied.json`.
- One resolved decision per answered choice.
- A final message in the shape of `assets/final-message.txt`.

## Escalate / Stop Conditions

- the result is invalid
- the team declines
- a script exits 2 (git or `gh` failed): report the error and stop, don't guess

## Gotchas

- The scripts are thin wrappers around `paqad-ai git-workflow`. When `paqad-ai` isn't on the PATH they try `npx --no-install paqad-ai`, and they exit 2 if neither starts. Report that; don't fall back to editing the files.
- `check` reports a file someone edited by hand in `changed_outside`. Never accept it with `--accept` on your own; ask the team first, because accepting makes that edit the new baseline.
- `apply.mjs` refuses to replace existing files without `--overwrite`. Always look at the `--dry-run` diff first.
- A `null` value in `change.json` only removes a branch type or a ticket source. Any other key can't be removed, so change it to the value the team wants instead.

## Resources

- `scripts/check.mjs`: `paqad-ai git-workflow check [--accept]`
- `scripts/propose.mjs`: `paqad-ai git-workflow setup`
- `scripts/apply.mjs`: `paqad-ai git-workflow setup --apply <answers.json> [--overwrite] [--dry-run]`
- `scripts/change.mjs`: `paqad-ai git-workflow change --plan|--apply <change.json>`
- `references/settings.md`: every setting, with its file, key, type, default and meaning
- `references/signals.md`: what each history signal means, and the thresholds
- `references/questions.md`: the starter questions for a new project
- `references/summaries.md`: how to write a plain-language summary
- `assets/answers.template.json`, `assets/change.template.json`, `assets/final-message.txt`
