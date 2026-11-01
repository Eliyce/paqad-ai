# Making the documents readable

Get the project in front of you by capability, not by host (GRD-3). Work only from what you
actually read, and name anything you need but cannot reach. The evidence level you reach, the
source line and the upgrade nudge are defined once in `evidence-levels.md`; detect the
level there and answer at the best level the repository allows.

## By capability

- If you have a tool that can read repository files on demand, read the paths in the reading order
  with it, starting with `docs/instructions/registries/modules.md`, and read the code when the
  answer needs an area the documents do not cover.
- Otherwise, ask the user to attach the repository or the `docs/` folder to the chat or project, or
  to upload `docs/` as files or a zip, then read the same paths once they are available.
- When the whole folder is large, ask for the smallest set the reading order allows (U-5): the
  modules registry first, then only the summaries and business notes for the related areas.

## Choosing the repository

Settle which repository to read before reading anything else, and ask about it at most once.

- Already available. When a repository or its `docs/` folder is already attached, uploaded or
  readable from the working folder, use it and ask nothing about which repository. When more than
  one is attached, offer the choice list below over the attached ones only.
- Exactly one reachable. When nothing is attached and a tool can list the repositories the user can
  reach, and it lists exactly one, use it without asking and lead with the answer. Read it on
  demand; when the tool cannot read files, ask to attach that named repository.
- Several reachable. Show one short choice list of all of them, most recently active first (the
  last push or update the tool shows). Keep the tool's own order when it shows no activity time, and
  for ties. Each row is the repository name as the tool shows it and one mark from the evidence
  levels: from project docs, from docs and code, from code only or not checked (unreadable). Mark
  exactly one as recommended, with a one-clause reason. Use the host's choice prompt when it fits
  every repository; otherwise a short table in the reply with the columns repository and level. Keep
  the question under about 40 words plus its choices.
- Nothing to list. When no tool can list repositories, or it lists none, ask to attach or upload as
  above. Invent nothing.

Work out the marks with the onboarded check below, only for the repositories shown, and read
nothing else before the user chooses. A repository whose files cannot be read (no read tool, or a
read fails) is not checked. A repository with readable code is always at least from code only, so it
is ranked and recommendable; the only unrecommendable state is not checked.

Recommend the most recently active richest repository: from project docs first, then from docs and
code, then from code only, then not checked. A code-only repository is recommendable.

## Remembering the choice

- In a run, the step that chose the repository writes `setup.repository` (the name as the tool or
  attachment shows it, empty when none is shown), `setup.repository_state` (`ready` or
  `partly-ready`) and `setup.evidence_level` (`project-docs`, `docs-and-code` or `code-only`):
  get-connected at step 0, or the first docs-reading step of a refine or size run.
- For a question outside a run, the choice holds for the rest of the conversation.
- Later questions, later steps and a resumed run ask nothing about the repository. On resume, when
  the recorded repository can no longer be read, ask to attach that same repository, not a new list.
- Switch only when the user asks (names another repository or asks to use another one); never
  switch on your own. Check the requested one and use it from then on; in a run, patch `setup`
  through `record.py update` and redo step 2 onward as a go back, saying in one line what changes.

## The onboarded check (GRD-1)

The check reads the modules list, `docs/instructions/registries/modules.md`, and the area
summaries, `docs/modules/<area>/index/summary.md` for each folder under `docs/modules/` (a folder
whose name starts with a dot is not an area). A file that is empty, holds only whitespace or cannot
be read counts as missing. Where the check script ships with the skill, run it; otherwise do it by
hand: list the `docs/modules` folders, read each `index/summary.md`, then look for the modules list.
Its output names the evidence level; its not-set-up output is read as the code-only level, not a
stop.

| State | Evidence level | What to do |
|---|---|---|
| ready | project-docs | Carry on from project docs. |
| partly ready | docs-and-code | Carry on, say the docs-and-code sentence once. |
| not set up | code-only | Answer from code by names; never a stop when code is reachable. |

The docs-and-code sentence, exactly, said once in the first reply that uses that repository:

> This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown.

Follow it with one short line naming the areas without a summary as not documented, in plain words
(folder names with hyphens and underscores shown as spaces, never a path); leave the line out when
there are none. A missing summary is never read as a missing feature. Later replies name such an
area only when the question touches it, and nothing is invented for it.

In code-only mode there are no paqad docs. Answer from code, labelled as what the code suggests,
with the "paqad, from code only" source line, and never say an area is not built. The only stop is
nothing readable at all: no usable docs and no reachable code. The upgrade nudge is optional and at
most once, worded for the level: in code-only mode it offers to install paqad, exactly:

> This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back.

## What never to read

Never read `.paqad/` runtime state, `docs/instructions/rules/`, secrets, environment files, `.git/`,
`vendor/` or `node_modules/`. This skill only reads; it never edits the repository.
