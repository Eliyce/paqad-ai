# Making the documents readable

Get the onboarded documents in front of you by capability, not by host (GRD-3). Work only from what
you actually read, and name anything you need but cannot reach.

## By capability

- If you have a tool that can read repository files on demand, read the paths in the reading order
  with it, starting with `docs/instructions/registries/modules.md`.
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
  for ties. Each row is the repository name as the tool shows it and one mark: ready, partly ready,
  not set up or not checked. Mark exactly one as recommended, with a one-clause reason. Use the
  host's choice prompt when it fits every repository; otherwise a short table in the reply with the
  columns repository and state. Keep the question under about 40 words plus its choices.
- Nothing to list. When no tool can list repositories, or it lists none, ask to attach or upload as
  above. Invent nothing.

Work out the marks with the onboarded check below, only for the repositories shown, and read
nothing else before the user chooses. A repository whose files cannot be read (no read tool, or a
read fails) is not checked. Never mark a repository ready unless the check passed on files you read.

Recommend the most recently active ready repository; if none is ready, the most recently active
partly ready one; if neither, the most recently active not checked one. Never recommend one that is
not set up. When every reachable repository is not set up, show no list: reply with the onboarding
sentence below and stop.

Run the full check on the chosen repository. When it is not set up, reply with the onboarding
sentence, then, when others were marked ready or partly ready, one short line offering those, ready
first. Draft and answer nothing from it.

## Remembering the choice

- In a run, the step that chose the repository writes `setup.repository` (the name as the tool or
  attachment shows it, empty when none is shown) and `setup.repository_state` (`ready` or
  `partly-ready`): get-connected at step 0, or the first docs-reading step of a refine or size run.
- For a question outside a run, the choice holds for the rest of the conversation.
- Later questions, later steps and a resumed run ask nothing about the repository. On resume, when
  the recorded repository can no longer be read, ask to attach that same repository, not a new list.
- Switch only when the user asks (names another repository or asks to use another one); never
  switch on your own. Check the requested one. Ready or partly ready: use it from then on; in a run,
  patch `setup` through `record.py update` and redo step 2 onward as a go back, saying in one line
  what changes. Not set up: the onboarding sentence, and the current repository stays.

## The onboarded check (GRD-1)

The check reads the modules list, `docs/instructions/registries/modules.md`, and the area
summaries, `docs/modules/<area>/index/summary.md` for each folder under `docs/modules/` (a folder
whose name starts with a dot is not an area). A file that is empty, holds only whitespace or cannot
be read counts as missing. Where the check script ships with the skill, run it; otherwise do it by
hand: list the `docs/modules` folders, read each `index/summary.md`, then look for the modules list.

| State | When | What to do |
|---|---|---|
| ready | the modules list and at least one area summary | Carry on. |
| partly ready | at least one area summary, no modules list | Carry on, say the partly ready sentence once. |
| not set up | no area summary, whatever else exists | Reply with the onboarding sentence. Draft and answer nothing. |

The onboarding sentence, exactly:

> This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back.

The partly ready sentence, exactly, said once in the first reply that uses that repository:

> This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown.

Follow it with one short line naming the areas without a summary as not documented, in plain words
(folder names with hyphens and underscores shown as spaces, never a path); leave the line out when
there are none. A missing summary is never read as a missing feature. Later replies name such an
area only when the question touches it, and nothing is invented for it.
`docs/instructions` alone is not set up, because it holds no business content. This plugin does not
onboard repositories.

## What never to read

Never read `.paqad/` runtime state, `docs/instructions/rules/`, secrets or environment files. This
skill only reads; it never edits the repository.
