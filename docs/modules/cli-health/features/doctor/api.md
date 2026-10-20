# paqad-ai doctor: API View

> Module: **Health & Diagnostics Commands** (`cli-health`) · Layer: `cli-commands` · Feature slug: `doctor`

## CLI

```
paqad-ai doctor [--project-root <path>]
```

`--project-root` defaults to the current directory. Doctor prints one JSON report to stdout and changes nothing. The exit code is 1 when the overall status is `fail`, and 0 otherwise, so a warning never fails a script.

## Output shape

```ts
interface HealthReport {
  overall_status: 'pass' | 'fail' | 'warning';
  checks: HealthCheckResult[];
  efficiency: {
    context_hit_rate: number;
    skill_cache_hit_rate: number;
    mcp_usage_rate: number;
  };
}

interface HealthCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'info';
  detail: string;
  remediation?: string;
}
```

`overall_status` is `fail` if any check fails, then `warning` if any check warns, then `pass`. An `info` check never moves it. A `warning` or `fail` check carries a `remediation`; a `pass` or `info` check does not. Each check is keyed by its `name`, which is stable text, not an id.

## `src/health/checker.ts`

```ts
export interface HealthCheckerOptions {
  managedSettingsPaths?: string[];
}

export class HealthChecker {
  constructor(options?: HealthCheckerOptions);
  run(projectRoot: string): Promise<HealthReport>;
}

export function deriveOverallStatus(checks: HealthCheckResult[]): HealthCheckStatus;
```

`managedSettingsPaths` replaces the OS managed-policy file locations, so tests can point doctor at a sandboxed policy file. The CLI passes nothing and the real locations are read.

## Checks

The checks run in this order. Each row lists the statuses that check can return.

| Check name | Can be |
| --- | --- |
| `Framework artifacts exist` | pass, fail |
| `Profile is valid` | pass, fail |
| `Detection report is valid` | pass, fail |
| `Onboarding manifest is valid` | pass, fail |
| `Decision workspace ready` | pass, warning |
| `Stack snapshot present` | pass, fail |
| `Stack drift report present` | pass, fail |
| `Module health ledger valid` | pass, fail |
| `Instruction copies exist` | pass, fail |
| `Indexes are current` | pass, warning |
| `Adapter config is present` | pass, fail |
| `Codex hooks wired` | pass, warning |
| `Edit gates fail closed` | pass, warning |
| `Entry files point to the framework bootstrap` | pass, warning, fail |
| `Entry files carry the graceful-degradation fallback clause` | pass, warning, fail |
| `Stack commands configured` | pass, fail |
| `Test runner parallel mode` | pass, warning |
| `Structured test output ready` | pass, warning, fail |
| `Stable framework paths only` | pass, fail |
| `Session sentinels untracked` | pass, warning |
| `Framework install` | pass, warning |
| `Claude Code install` | pass, warning |
| `Schema version` | pass, warning |
| `No broken scaffold state` | pass, fail |
| `UI docs present`, `API docs present`, `Integration docs present`, `Error catalog present` | pass, fail |
| `MCP servers (recommended)` | info |
| `Skill cache healthy` | pass, warning |
| `Context hit rate acceptable` | pass, warning |
| `Lean rule footprint acceptable` | pass, warning |
| `Compiled rules are current` | pass, fail |
| `Classification override rate acceptable` | pass, warning |
| The `RAG ...` checks listed below | pass, warning |
| `Spec pipeline is healthy` | pass, warning, fail |
| `Spec pipeline settings` | pass |
| `Spec pipeline adoption is coherent`, `Standing experts are all expert roles`, `Expert lens files are shipped`, `Spec pipeline token ceiling fits the experts`, `Expert roster config is coherent` | pass, warning, fail |
| `Visual evidence is ready` | pass, warning |

The `RAG ...` checks, in order: `RAG index present`, `RAG provider matches profile`, `RAG chunk index present`, `RAG chunk index current`, `RAG vector payload consistent`, `RAG retrieval ready`, `RAG model cache present`, `RAG vector gitignore present`, `RAG secrets gitignore present`, `RAG secret permissions acceptable`, `RAG engine installed`.

With RAG off, every `RAG ...` check passes with the detail `RAG is disabled`.

## `Claude Code install`

The detail comes from `describeClaudeInstall` in `src/install/plugin-migration.ts`, which returns `{ detail, level: 'pass' | 'warning', remediation? }`. The first case that matches wins.

| Situation | Status | Detail |
| --- | --- | --- |
| A managed policy turns hooks off (`allowManagedHooksOnly` or `disableAllHooks`) | warning | `A managed policy blocks paqad's hooks, so paqad's checks don't run here.` with the fix `Ask IT to deploy the paqad plugin as a managed plugin, or allow its hooks.` |
| A managed policy blocks the plugin (`enabledPlugins` false, strict or blocked marketplaces) | pass | `plugin blocked by policy; paqad stays on npm` |
| The plugin was moved to, but the user turned it off | pass | `npm (migration declined: user-disabled)` |
| The plugin is installed and on, and there is no npm copy | pass or warning | `plugin`, with the version suffix below |
| The plugin root is a copy synced from claude.ai | pass | `plugin (synced from claude.ai)` |
| No move recorded yet | pass | `npm` |
| The move is done | pass or warning | `plugin (migrated <date>, via <path>)`, where the path is `cli`, `bundled-cli`, `settings` or `synced`, with the version suffix when the plugin is installed |
| The plugin install was recorded, but Claude Code has not installed it yet | pass | `npm (migration installed: waiting for Claude Code to install the plugin)` |
| The plugin is installed, but has not loaded in a session yet | pass | `npm (moving to the plugin: waiting for the plugin to load in a new session)` |
| Any other recorded state | pass | `npm (migration <state>: <reason>)`, for example `npm (migration failed: path-a-failed:cli-install-failed:exit)`, `npm (migration skipped: no-claude-cli)` or `npm (migration skipped: bundled-cli-failed:<reason>)` |

The text `n/a` never appears.

**Version suffix.** When the plugin's version can be read, the detail ends with `; plugin v<plugin version>, paqad-ai v<npm version>`. The plugin version is read from the plugin root: the package.json under the `installPath` that `installed_plugins.json` records (in `CLAUDE_CONFIG_DIR`, else `~/.claude`), then the version recorded there, then the version file of the runtime copy in the plugin data folder. If none can be read the suffix is left off, never shown as `vunknown`. When the two versions differ (a stale plugin cache) the check warns with the fix ``The plugin and paqad-ai are on different versions. Start a new Claude Code session so the plugin updates, or run `claude plugin update paqad@eliyce`.``

**npm hooks suffix.** On the synced and migrated lines, a project that still wires the npm hooks gets `; this project still runs the npm hooks (<files>)`, naming the user settings file, the project `.claude/settings.json`, or both.

## `RAG engine installed`

| Engine state | Status | Detail |
| --- | --- | --- |
| ready | pass | `The embedding engine is installed` |
| installing | warning | `not ready: installing in the background; retrieval uses text search until it is ready` |
| install failed | warning | `The embedding engine install failed: <reason>` |
| not installed | warning | `The embedding engine is not installed; retrieval uses text search` |

## `RAG model cache present` and `RAG vector gitignore present`

`RAG model cache present` looks for the local model under `~/.paqad/models`, resolved the same way the embedding provider resolves it. When it is missing the check warns `Local embedding model cache is missing` with the fix ``Run `paqad-ai rag rebuild` to download and cache the local model.`` A provider that is not local passes with `Local model cache is not required for this provider`.

`RAG vector gitignore present` asks git about `.paqad/vectors/` with the trailing slash, so it passes as soon as the managed `.paqad/.gitignore` lists the folder, even before the folder exists. Otherwise it warns `Vector index path is not gitignored: .paqad/vectors` and says to re-run `paqad-ai onboard`.

## `Session sentinels untracked`

| Situation | Status | Detail |
| --- | --- | --- |
| Not a git repository | pass | `Not a git repository, nothing to check` |
| git tracks nothing there | pass | `git tracks nothing under .paqad/.agent-entry-loaded.d` |
| git tracks files there | warning | `git tracks <n> per-session file(s) under .paqad/.agent-entry-loaded.d, so every session dirties the tree` with the fix ``Run `git rm -r --cached .paqad/.agent-entry-loaded.d` and commit the change.`` |
