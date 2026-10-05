# Making the documents readable

Get the onboarded documents in front of you by capability, not by host (GRD-3). Work only from what
you actually read, and name anything you need but cannot reach.

## By capability

- If you have a tool that reads repository files on demand, read the paths in the reading order
  with it, starting with `docs/instructions/registries/modules.md`.
- Otherwise, ask the user to attach the repository or the `docs/` folder to the chat or project, or
  to upload `docs/` as files or a zip, then read the same paths once they are available.
- When the whole folder is large, ask for the smallest set the reading order allows (U-5): the
  modules registry first, then only the summaries and business notes for the related areas.

## The onboarded check (GRD-1)

The repository counts as onboarded only when both of these exist:

- `docs/instructions/registries/modules.md`
- at least one `docs/modules/<module>/index/summary.md`

If either is missing, stop with: "This repository isn't set up for this yet. Ask your engineering
team to onboard it with paqad, then come back." This plugin does not onboard repositories.

## What never to read

Never read `.paqad/` runtime state, `docs/instructions/rules/`, secrets or environment files. This
skill only reads; it never edits the repository.
