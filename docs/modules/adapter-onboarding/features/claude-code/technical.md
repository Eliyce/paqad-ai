# Claude Code (CLAUDE.md) — Technical View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `claude-code`

## Module Boundaries

Source directories owned by this feature:

- `src/adapters`
- `src/onboarding/file-writer.ts`

Generated outputs (when applicable):

- `CLAUDE.md`

MCP config is not a generated output: paqad never writes another tool's MCP file (issue #622). Server
suggestions go to `.paqad/mcp-recommendations.json`.


## Entry Points

- CLI entry: `paqad-ai claude code` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- What state this feature reads.
- What state this feature writes.
- Where that state is persisted (`.paqad/**`, project files, in-memory only).

## Error Codes

- Structured error IDs emitted by this feature.
- Mapping from error ID → user-facing message → recovery action.

## Dependencies

- **Internal:** other paqad-ai modules this feature imports or calls.
- **External:** npm packages, system binaries (`node`, `git`, etc.).
- **Runtime data:** files that must already exist before this feature runs.

## Configuration

- Environment variables read.
- Config keys in `.paqad/project-profile.yaml` or `.paqad/onboarding-manifest.json`.
- Default values and override precedence.

## Testing Entry Points

- Unit test files that cover `claude-code` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## Onboarding from the plugin

- The plugin brings its own hook chain (`runtime/claude-plugin/hooks.json`), so onboarding from
  the plugin writes no paqad hook into the project's `.claude/settings.json`. Every other part
  of that file (attribution, permissions) is written as for npm.
- `isRunningUnderPlugin` in `src/adapters/claude/claude-adapter.ts` reads three signals:
  `CLAUDE_PLUGIN_ROOT`, the running runtime root, and the CLI entry (`process.argv[1]`). The
  last two count when they sit under a `plugins/cache/` or `plugins/data/` folder. The agent's
  shell and the plugin CLI wrapper do not set `CLAUDE_PLUGIN_ROOT`, so the path signals are what
  catch `/paqad:onboard`. With none of the three, onboarding is the npm onboarding, byte for
  byte (pinned by `tests/unit/adapters/native-hook-config.golden.test.ts`).

## The plugin runtime copy

- `~/.paqad-ai/current` must survive Claude Code deleting an old plugin cache folder. The
  plugin keeps a real copy of its `package.json`, `dist/` and `runtime/` in
  `${CLAUDE_PLUGIN_DATA}/runtime`, with a `version` file, and points the link at
  `${CLAUDE_PLUGIN_DATA}/runtime/runtime`. It never points the link at `cache/<version>/`.
- The copy carries `dist/` and `package.json` because hooks reached through the link import
  `../../dist/...` relative to themselves, and doctor and the engine installer read the
  `package.json` one level above the link target.
- The copy is staged in `${CLAUDE_PLUGIN_DATA}/runtime.tmp-<pid>` and renamed into place with
  the bounded Windows rename retry. It is refreshed only when the `version` file differs from
  the running plugin's version. A `runtime` symlink or junction left by an older paqad is
  replaced by the real folder, and a link still aimed at that old folder is moved onto the copy.
- The logic has two mirrored copies that must stay in step: `ensureStablePluginRuntime` in
  `src/install/bootstrap.ts` and in `runtime/hooks/plugin-session-start.mjs` (the hook is
  dist-less, so it cannot import the TypeScript one). `tests/unit/install/bootstrap-plugin-link.test.ts`
  drives both over the same fixtures.
