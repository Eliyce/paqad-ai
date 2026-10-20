# Organization Rollout (managed-settings and hook): API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `managed-settings`

## `paqad-ai managed-settings`

```text
paqad-ai managed-settings [--write <dir>] [--no-plugin] [--project-root <path>]
```

- No `--write`: prints the JSON to stdout.
- `--write <dir>`: creates `<dir>` when needed and writes only `<dir>/paqad.json`, then prints
  "wrote the managed settings to <path>".
- `--no-plugin`: leaves out `extraKnownMarketplaces` and `enabledPlugins`.

Exit codes: `0` on success; `1` when `enterprise.enabled` is false (message `managed-settings is
part of paqad for teams; set enterprise.enabled=true`) or the file cannot be written.

## `paqad-ai hook`

```text
paqad-ai hook [--managed] <capability-gate|decision-pause-gate> [args...]
```

Reads the Claude Code hook payload on stdin. `args` go to the gate script, for example
`pre-mutation` for the capability gate. `--managed` runs the gate as enforced by the
organization.

Exit codes: the gate's own code when it ran; `0` with no output when the payload's `cwd` is not
inside a paqad project; `2` for an unknown name, a bad payload, a missing script, a spawn error or
a timeout.

## Library surface

- `buildManagedSettings({ plugin }): Record<string, unknown>`.
- `runPaqadHook({ name, args, managed, input, env?, runtimeRoot?, timeoutMs? }):
  Promise<{ exitCode, stdout, stderr, spawned }>`.
- `packagedHookScript(name, runtimeRoot): string | null`.
