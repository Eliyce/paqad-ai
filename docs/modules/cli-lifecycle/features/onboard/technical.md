# paqad-ai onboard — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `onboard`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/onboard.ts`
- `src/onboarding`



## Entry Points

- CLI entry: `paqad-ai onboard` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- RAG enablement, provider, and model are written through `setGroupConfigValue` to the tracked `.paqad/configs/.config.rag` group file. The writer activates generated commented defaults in place and preserves file ordering.
- `writeOnboardingManifest` normalizes persisted paths and deterministic collections before serialization. When semantic content is unchanged, it carries forward both `generated_at` and `detected.timestamp` and avoids rewriting byte-identical output.
- Detection signals and generated artifact paths are repository-relative; ignored repository paths omit `.DS_Store`, `.idea`, and `.vscode` noise and are sorted.

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

- Unit test files that cover `onboard` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## RAG at onboarding

- When the lead turns RAG on with the local provider and the embedding engine is missing (the
  plugin case), onboarding keeps `rag_enabled=true`, starts the background engine install with
  the project root (`ragEngineInstallingInBackground` in `src/onboarding/rag-onboarding.ts`) and
  returns one warning: "search index is installing in the background; text search until it
  is ready". The index is built by the installer once the engine is in place.
- When the install cannot start (for example no `CLAUDE_PLUGIN_DATA`, or a recent failed
  attempt) onboarding tries the build as before. Any build failure turns RAG off and says so:
  "RAG was turned off: <reason>". The setting is never flipped without that line.
- The orchestrator only returns these lines in `OnboardingOutput.warnings`, together with the
  unmapped-commands warning. Kept files and drift review targets come back in their own fields
  (`kept_files`, `drift_review_targets`), so the CLI never has to tell them apart by matching
  strings. The `onboard` command (`src/cli/commands/onboard.ts`) prints, after the rest of its
  output, one `Kept <n> existing files unchanged.` line, the drift targets under
  `Review these for drift:` as indented plain lines, and then each warning once as
  `⚠ <warning>`: yellow on a terminal, plain text otherwise.

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/onboarding/`.

- **`agent-bootstrap-writer.ts`, `narration-contract-writer.ts`, `decision-pause-contract-writer.ts`.**
  The framework doc is split into a gate (`AGENT-BOOTSTRAP.md`, only the enablement check) and a
  router (`AGENT-ROUTER.md`), so the verdict is resolved before any other prose loads and a
  disabled project reads none of it. The router inlines the narration and decision-pause contract
  bodies from their builders so it cannot drift; the `claude-code` row of the per-adapter table is
  what keeps the Claude Code decision tray firing. The rendered docs are committed under
  `runtime/` and never written into a project; a golden test holds them byte-identical to the
  builders.
- **`agent-registry-writer.ts`.** The roster page is generated from `AGENT_ROLES`, the expert
  roster and the token budgets, because three hand-kept descriptions used to disagree.
- **`checkpoint.ts`.** Written paths are stored posix through a temp file and rename, so a killed
  run resumes with only the remainder; a malformed checkpoint counts as absent, since rewriting
  everything is safe.
- **`create-project.ts` and `onboard-installed-stack.ts`.** "No stack yet" is deliberately not a
  `Stack` value, so a created workspace never picks up a framework's default commands; its
  commands are self-explaining placeholders sharing one prefix, which is how readiness and the
  installed-stack step recognise them. A non-empty folder without `.paqad/` is refused unless
  forced. `git init` runs only outside an existing work tree, and a git failure is reported, not
  fatal. A plain re-onboard cannot lift the placeholders, because config preservation carries
  them forward, so the installed-stack step re-derives commands, but only when a real framework is
  detected; with none, detection falls back to a default stack and would hand out wrong commands.
- **`decision-id-migration.ts`.** Old sequential `D-<n>.json` packets seed the pattern for the next
  agent and collide across branches, so each onboard and update renames them to `D-<ULID>.json`
  and updates the index. A broken packet is left in place.
- **`entry-stub-writer.ts`.** A project-owned entry file (for example one written by another tool)
  is never overwritten, so paqad's stub is appended as a marker-fenced block; a file that already
  carries the bootstrap pointer is left alone so the contract is not duplicated.
- **`file-writer.ts`.** Each target is opened once and its mtime and content read from the same
  handle, avoiding a check-then-use race.
- **`gitignore-writer.ts`.** Git hygiene lives in `.paqad/.gitignore` and `.paqad/.gitattributes`
  so no project-owned file is edited; the old block in the root files is scrubbed.
  `framework-path.txt` stays committed so a teammate can boot after cloning;
  `framework-version.txt` is ignored because it churns every session. `ledger/`, `checks/`,
  `compliance/` and `tmp/` are ignored unconditionally, since a conditional ignore leaks. The
  decision index uses `merge=union`. Tracked paths are found with one `git ls-files`, because one
  process per path timed out under load. Files paqad no longer creates are untracked and removed.
- **`manifest-writer.ts`.** A corrupt manifest blocks onboarding with `REGISTRY_CORRUPTED` rather
  than being overwritten. A rewrite equal except for the timestamp keeps the old file. Relative
  inputs are returned as is, because `path.relative` resolves both sides against the cwd.
- **`obsolete-cleanup.ts`.** Old project copies of the two contracts are removed only when they
  start with paqad's managed header.
- **`orchestrator.ts`.** Onboarding is two phases: every core file is written first with no
  prompt, then the optional RAG step runs, so a hanging RAG prompt cannot leave a half-onboarded
  project. A re-onboard is a refresh: user-set sections are carried forward and only
  detection-derived fields change. Entry files are written on a fresh run but never overwritten
  later without `forceOverwrite`. The rule-script map is generated before the planning-rule
  compile, because it embeds rule ids into the markdown; doing it first keeps a re-onboard
  byte-identical. The `project.onboarded` audit event is written only on the first onboarding.
  `ENOSPC` becomes a clean framework error. pnpm passes a literal `--` to the script, which makes
  the test runner ignore later flags, so the structured reporter command omits it for pnpm. Laravel
  tests always run through Artisan, whose `--parallel` sets up the per-process databases.
- **`rules-refresh.ts`.** Generated rule files are deleted before the rewrite, because they are
  written skip-if-present; `module-map.yml` and `rule-script-map.yml` are project-owned and kept.
- **`setup-plan.ts`.** paqad ships no installers: the plan only records the official commands and
  tracks each step's state. A step's prerequisite must be an earlier step.
- **`worktree-include-writer.ts`.** Git copies paths listed in `.worktreeinclude` into new
  worktrees, so `.paqad/.config` is appended there; the file is project-owned, so it is a plain
  append, never a managed block.
