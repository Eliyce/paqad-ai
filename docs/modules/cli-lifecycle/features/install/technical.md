# paqad-ai install — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `install`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/install.ts`
- `src/install`

## Why the code works the way it does

The reasons below are not obvious from the code in `src/install/`.

- **`bootstrap.ts`.** The home-only half (the `~/.paqad-ai/current` link and the six stage agents
  under the user home) writes nothing into the project, so `paqad-ai join` can set up a new machine
  without producing a diff; the project-side writes are layered on top for `onboard` and `install`.
  The stage agents are always rendered (stage isolation has no knob) and a failure there never fails
  the install, since the agents are inert until dispatched and the next update retries. The `.paqad/`
  schema marker is created only when missing; migrating it is another module's job.
- **The plugin-safe link rule in `bootstrap.ts`** is a hand mirror of `repointFrameworkLink` and its
  helpers in `runtime/hooks/plugin-session-start.mjs`. The runtime hooks have no dist and no
  dependencies (they run before any dist can be resolved), so neither side can import the other; a
  recorded decision chose two copies over one shared implementation, and
  `tests/unit/install/bootstrap-plugin-link.test.ts` drives both over the same fixtures and asserts
  the same decision (the exported helper exists only for that test). The rule: a real directory is
  never replaced, a link to a working npm install is never taken over, an unknown working directory
  is left alone, and only the plugin's own earlier cache link, the plugin runtime itself, or a
  missing or dangling link is pointed at the stable `${CLAUDE_PLUGIN_DATA}/runtime` (or the cache
  runtime when that variable is unset). A failed re-point never fails the install.
- **Link creation.** On Windows the link is a junction, because a directory symlink needs Developer
  Mode or admin and throws `EPERM` otherwise. The old link is checked with `lstat`, not `existsSync`,
  because `existsSync` follows the link: a dangling one (its npx cache was cleaned up) would read as
  absent and `symlinkSync` would then fail with `EEXIST`.
- **`consumer-compatibility.ts` and `version-report.ts`.** Only a major-version difference is
  breaking, and the major is read with a plain integer parse so there is no `semver` dependency. A
  consumer version that cannot be parsed is treated as too old, so a broken consumer refuses to
  start. The version is read from the build-time `__PKG_VERSION__` define directly instead of from
  the package barrel, which would be an import cycle; the normalising helper is exported because a
  textual define cannot be mocked at runtime. The report is computed once, frozen and does no I/O.
- **`plugin-migration.ts`.** Every outside effect (home, clock, the `claude` CLI, the managed-settings
  paths) is injected so the whole state machine runs against a sandboxed home in tests. The
  `claude plugin` runs are synchronous because `update --silent` is already a detached background
  process, so waiting blocks no session and lets the result be checked; a failed `marketplace add` is
  tolerated since it may already be registered. On Windows `claude` is a `.cmd` shim, and only static
  arguments are passed, so going through the shell is safe. The plugin counts as present when Claude
  Code lists it or the plugin wrote `plugin-seen.json`, because the claude.ai synced copy leaves no
  install record; that marker is removed after a rollback so a stale one cannot skip the next real
  install. An npm SessionStart waits briefly for the parallel plugin SessionStart to write it. A
  record written before `installed_at` existed has it seeded once from its own `last_attempt_at`, so
  later counter bumps never move the baseline. The machine lock counts as stale after 15 minutes,
  safely above the longest hold (the three bounded `claude` runs, about 7 minutes); a stale lock is
  renamed aside before removal so two reapers cannot both take it. The user-settings merge keeps
  every other key byte for byte and leaves invalid JSON untouched. The doctor's check for live npm
  hooks mirrors `claudeSettingsPath` and `hasLiveNpmHookLines` in
  `runtime/hooks/lib/paqad-disabled.mjs`, because `src` cannot import the runtime hook libraries.

## Entry Points

- CLI entry: `paqad-ai install` (verify exact flag set in the source).

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

- Unit test files that cover `install` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
