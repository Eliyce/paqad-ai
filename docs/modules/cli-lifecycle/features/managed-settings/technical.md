# Organization Rollout (managed-settings and hook): Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `managed-settings`

## Module Boundaries

- `src/cli/commands/managed-settings.ts`: `buildManagedSettings`, the command, and the constants
  `MANAGED_SETTINGS_FILE` (`paqad.json`), `MANAGED_HOOK_COMMANDS`, `MANAGED_HOOK_TIMEOUT_SEC` (30).
- `src/cli/commands/hook.ts`: `runPaqadHook`, `packagedHookScript`, `MANAGED_HOOK_NAMES`,
  `MANAGED_INSTALL_FIX`.
- `src/install/plugin-migration.ts`: `pluginSettingsKeys()` (the two plugin keys, shared with the
  npm-to-plugin move) and `defaultManagedSettingsPaths()`.
- `runtime/hooks/lib/paqad-disabled.mjs`: reads `PAQAD_MANAGED` and holds the organization line.

## The managed settings file

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "paqad-ai hook --managed capability-gate pre-mutation", "onFailure": "block", "timeout": 30 },
          { "type": "command", "command": "paqad-ai hook --managed decision-pause-gate", "onFailure": "block", "timeout": 30 }
        ]
      }
    ]
  },
  "extraKnownMarketplaces": {
    "eliyce": { "source": { "source": "github", "repo": "Eliyce/paqad-claude-plugin" }, "autoUpdate": true }
  },
  "enabledPlugins": { "paqad@eliyce": true }
}
```

`--no-plugin` drops exactly `extraKnownMarketplaces` and `enabledPlugins`. The matcher is the
same `PAQAD_MUTATING_TOOL_MATCHER` the other hook routes use.

## `paqad-ai hook` behaviour

1. Accept only `capability-gate` and `decision-pause-gate`; anything else exits 2 with
   `unknown paqad hook <name>`.
2. Load the runtime hook library from the installed runtime; a failure exits 2 and names the fix.
3. Parse the payload from stdin. An unreadable payload, or one with no `cwd`, exits 2.
4. Walk up from `cwd` for a `.paqad/` folder. None found: exit 0 with no output, before any
   config is read or script started, so a non-paqad project stays fast.
5. Resolve the gate script from the same live hook table the hook renderer uses
   (`PAQAD_LIVE_HOOKS`), never from the payload, the project or an environment variable.
6. Run it with the same stdin, adding `PAQAD_MANAGED=1` when `--managed` is given (no shell
   `VAR=value` prefix, so it works on Windows), with a 25 second limit.
7. Return the script's exit code, stdout and stderr byte for byte. A spawn error, a signal or the
   time limit exits 2 with `[paqad] hook <name> did not finish (<why>). paqad-ai must be
   installed globally on this machine; ask IT to install it.`

## Managed gate rules

- With `PAQAD_MANAGED=1` the capability and decision-pause gates do not stand down for
  `PAQAD_DISABLED` or `paqad_enable=false`.
- A capability block adds "This rule is enforced by your organization's settings." to stderr and
  marks the rule-stop record `managed`.
- The managed route has its own test file, `tests/e2e/managed-route-contract.e2e.test.ts`. It
  runs every stage contract case that reaches the capability or decision-pause gate through
  `paqad-ai hook --managed` and through the npm route, and expects the same exit code, stdout and
  stderr, apart from that one line. It reads the case list from the stage contract test, so a new
  contract case that reaches either gate fails it until the managed route covers it. The stage
  contract test itself still runs the npm and plugin routes only.
