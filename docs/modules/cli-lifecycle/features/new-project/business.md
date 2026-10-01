# paqad-ai new project — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `new-project`

## Overview

`paqad-ai new project <name>` creates a **development workspace** — a directory with git, the
`.paqad/` footprint, documentation scaffolding and the host entry files — **without choosing an
application stack**. It is the day-zero entry point of issue #596 Slice 3 (the journey from an
empty workspace to a fully onboarded project), and the only fixed new public command the issue
defines. The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer / Operator** — runs `paqad-ai new project my-app` to start a new project.
- **CI pipeline** — may create a workspace non-interactively (providers default to `claude-code`).

## User Flows

- **Create an empty workspace.** The owner runs `paqad-ai new project my-app` in an empty parent.
  `my-app/` is created, git is initialized (unless already inside a work tree), the `.paqad/`
  footprint, docs scaffolding and host entry files are written, and the output states the
  application stack is **undecided** and names the next step (run discovery / choose a stack, then
  onboard).
- **Re-run / resume.** Re-running on a workspace that already carries `.paqad/` preserves the
  owner's work and completes only the remainder (the onboarding checkpoint handles resume).

## Business Rules

- Creation never creates application code, selects a language/framework, installs an SDK, or
  configures production infrastructure (ENT-01, INV-1).
- An empty project records **no framework default** — the recorded commands are self-explaining
  placeholders, not pnpm/react defaults (ENT-02, INV-5).
- A non-empty directory that is not a prior paqad workspace is never overwritten without `--force`;
  the command refuses and writes nothing (ENT-03).
- Creation reuses the onboarding engine; `onboard`, `install` and `update` are unchanged (INV-4).

## Triggers & Side Effects

- Creates the project directory and (when needed) a git repository.
- Writes the `.paqad/` footprint, documentation scaffolding and host entry files via onboarding.

## Error States

- `PROJECT_DIR_NOT_EMPTY` — the target directory is non-empty and not a paqad workspace; pass
  `--force` to overwrite or choose an empty directory. Nothing is written.
- A `git init` failure is recoverable, not fatal: creation succeeds and the issue is surfaced for
  the owner to initialize version control themselves.

## Glossary

- **Undecided stack** — a created workspace whose application language/framework has not been
  chosen; its profile records no framework and placeholder commands until a stack is onboarded.
