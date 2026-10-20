# Organization Rollout (managed-settings and hook): Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `managed-settings`

## Overview

An organization that wants paqad's edit-time rule block on every developer machine, with no way
to turn it off locally, uses Claude Code's managed settings. `paqad-ai managed-settings` prints or
writes the one file IT pushes through MDM. That file runs two packaged gates before every Edit,
Write and NotebookEdit through `paqad-ai hook --managed`, and turns the paqad plugin on from
`Eliyce/paqad-claude-plugin`. In a repository with no `.paqad/` folder the gates do nothing.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md). The step-by-step rollout is in the README section "Deploy for your
organization".

## User Roles

- **IT or platform admin**: generates the file, installs `paqad-ai` globally through MDM, then
  pushes the file.
- **Developer**: gets the block in every paqad project with nothing to set up; cannot loosen it.

## User Flows

1. Set `enterprise.enabled=true` and run `paqad-ai managed-settings --write <dir>`.
2. Install `paqad-ai` globally on every machine through MDM, before the file goes out.
3. Push `<dir>/paqad.json` into the platform's managed settings folder.
4. Check on a machine with `claude --debug` and `/status`.
5. To roll back, delete `paqad.json` through MDM.

## Business Rules

- Refused while `enterprise.enabled` is false (the default): "managed-settings is part of paqad
  for teams; set enterprise.enabled=true", exit 1, no file written.
- The managed gates ignore `PAQAD_DISABLED` and `paqad_enable=false`; the normal npm and plugin
  routes still honour both.
- Fail closed: a missing, broken or slow `paqad-ai` blocks the edit (`onFailure: block`,
  timeout 30 seconds), and the block says how to fix it.
- A capability block under managed settings ends with "This rule is enforced by your
  organization's settings." and can never be allowed once from the HUD.
- `--no-plugin` leaves the plugin keys out for an organization that installs the plugin another
  way.

## Triggers and Side Effects

- `managed-settings` prints JSON, or writes only `<dir>/paqad.json`.
- `hook` runs one packaged gate and passes its exit code, stdout and stderr through unchanged.

## Error States

- `hook` with an unknown gate name, an unreadable payload, a payload with no `cwd`, a missing
  gate script, a spawn error or a timeout: exit 2, so the edit is held.
- `managed-settings --write` into a folder it cannot write: exit 1 with the reason.
