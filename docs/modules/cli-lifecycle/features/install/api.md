# paqad-ai install: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `install`

## CLI

```
paqad-ai install [--project-root <path>]
paqad-ai plugin rollback [--project-root <path>]
```

`install` links the framework home, writes the stage agents under the user home, writes the framework metadata and the `.paqad/` schema marker into the project, and prints the result as JSON:

```json
{ "framework_home": "<path>", "project_root": "<path>", "version": "<paqad-ai version>" }
```

`plugin rollback` moves this machine back to the npm setup in Claude Code. It uninstalls the plugin with `claude` on the path, then with the `claude` the Desktop app bundles, records the move as `rolled-back` with reason `manual`, sets `claude_install_mode=settings` for the project, and prints one line:

| Outcome | Line |
| --- | --- |
| Plugin removed, or not installed | `paqad now runs from the npm package in Claude Code again. The plugin was removed.` |
| No `claude` could remove it, plugin turned off in user settings | ``The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it.`` |
| No `claude` could remove it, and turning it off failed | ``paqad could not turn the plugin off. Run `claude plugin uninstall paqad@eliyce` to remove it.`` |

`plugin tick --source <npm|plugin> [--session <id>]` is hidden. Hooks call it to count one Claude Code session against the move.

## `src/install/bootstrap.ts`

```ts
export interface InstallResult {
  framework_home: string;
  project_root: string;
  version: string;
}

export function bootstrapFrameworkHome(): { framework_home: string };
export function bootstrapFramework(
  projectRoot: string,
  options?: { logger?: EngineLogger },
): InstallResult;
export function frameworkSymlinkType(): 'junction' | undefined;
```

`bootstrapFrameworkHome` writes only under the user home, so `paqad-ai join` can use it without a project diff. `frameworkSymlinkType` returns `junction` on Windows.

## `src/install/plugin-migration.ts`

```ts
export type MigrationState =
  'pending' | 'installed' | 'done' | 'failed' | 'rolled-back' | 'declined' | 'skipped';
export type MigrationPath = 'cli' | 'bundled-cli' | 'settings' | 'synced';
export type ManagedPolicyBlock = 'hooks-blocked' | 'plugin-blocked';

export function maybeMigrateToPlugin(projectRoot: string, deps?: MigrationDeps): MigrationResult;
export function recordMigrationSession(
  input: { source: 'npm' | 'plugin'; sessionId?: string },
  deps?: SessionTickDeps,
): Promise<MigrationResult>;
export function rollbackPlugin(projectRoot: string, deps?: RollbackDeps): string;
export function classifyManagedPolicy(paths: string[]): ManagedPolicyBlock | null;
export function managedPolicyBlockReason(paths: string[]): string | null;
export function findBundledClaude(
  home: string,
  platform?: NodeJS.Platform,
  env?: NodeJS.ProcessEnv,
): string | null;
export function isSyncedRoot(root: string | undefined): boolean;
export function describeClaudeInstall(
  home?: string,
  projectRoot?: string,
  env?: NodeJS.ProcessEnv,
  options?: ClaudeInstallLineOptions,
): ClaudeInstallLine;
export function readInstalledPluginVersion(home: string, env?: NodeJS.ProcessEnv): string | null;
```

`MigrationResult` is `{ state, path?, reason? }`. `maybeMigrateToPlugin` never throws: an error comes back as `skipped` with reason `error:<message>`. `describeClaudeInstall` feeds the doctor `Claude Code install` line; its cases are listed in the doctor API view.

The move records its state in `~/.paqad-ai/plugin-migration.json`, the plugin's first session in `~/.paqad-ai/plugin-seen.json`, and its log in `~/.paqad-ai/logs/plugin-migration.log`.

Reasons a record can carry:

| Reason | State | Meaning |
| --- | --- | --- |
| `managed-policy` | skipped | A managed policy blocks the plugin or its hooks; nothing was written |
| `no-claude-cli` | skipped | No `claude` on the path and no Desktop app `claude` |
| `claude-too-old:<version>` | skipped | `claude` is older than the minimum version and no Desktop app `claude` was found |
| `bundled-cli-failed:<reason>` | skipped | The Desktop app `claude` could not install the plugin |
| `path-a-failed:<reason>` | failed | `claude` on the path could not install the plugin, for example `path-a-failed:cli-install-failed:exit` |
| `user-opted-out`, `user-disabled` | declined | The user turned the plugin off |
| `manual` | rolled-back | `paqad-ai plugin rollback` ran |
