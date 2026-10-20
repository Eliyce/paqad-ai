# Adapter Onboarding (LLM platform entry files)

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `adapter-onboarding`

## Purpose

Generates the thin entry file each external LLM agent platform reads on
startup. All entry files point back to the same shared instruction
bundles under `docs/instructions/` and the framework runtime, so one
onboarding configures every supported platform.

## Source Footprint

- `src/adapters`
- `src/onboarding/file-writer.ts`

## Features

- [Claude Code (CLAUDE.md)](../features/claude-code/business.md)
- [Codex CLI (AGENTS.md)](../features/codex-cli/business.md)
- [Google Antigravity (ANTIGRAVITY.md)](../features/antigravity/business.md)
- [Gemini CLI (GEMINI.md)](../features/gemini-cli/business.md)
- [JetBrains Junie](../features/junie/business.md)
- [Cursor](../features/cursor/business.md)
- [GitHub Copilot](../features/github-copilot/business.md)
- [Windsurf](../features/windsurf/business.md)
- [Continue](../features/continue/business.md)
- [Aider (config-only)](../features/aider/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code in `src/adapters/`.

- **Entry files (`shared/base-adapter.ts`, `shared/framework-fallback-clause.ts`).** The entry file
  is a lean stub pointing at `AGENT-BOOTSTRAP.md`; the load order and the narration and
  decision-pause contracts live only in the bootstrap, behind its enablement check. The fallback
  clause is generated once in core and is byte-identical for every host (a test checks this),
  because on a hook-less IDE the entry file is the only thing that can stop an absent or disabled
  paqad reading as "this tool broke my editor". It is not a `##` heading so it stays within the
  closed entry-file heading list.
- **Per-machine hook files.** Claude `settings.json`, Codex `hooks.json` and Gemini `settings.json`
  carry an absolute, machine-specific `node "<abs>"` command, so the adapters that wire real hooks
  also write a nested `.gitignore` in their config folder; committing those files would break a
  teammate or CI with another home directory or OS. paqad owns the `.gitignore` inside the folder it
  manages and never edits the project root one. The base `installHooks` sidecar goes to a
  paqad-internal path so it can never overwrite the file the host really runs. paqad writes no MCP
  config at any host path, because those files belong to the tools that read them and older versions
  overwrote servers teams had configured; Claude's `.mcp.json` is only read (by `doctor`).
- **Hook commands (`shared/paqad-hooks.ts`).** A command is `node "<abs>/hooks/<file>"`: Windows
  shells do not expand `~` and ignore shebangs and the executable bit, and `node` is always present
  for a Node CLI. The path is recomputed from the local home on every generation. One chain
  definition serves Claude Code and Codex, mapped to each host's event names and mutating-tool
  matcher (Codex matches `tool_name` with a regex, so `^apply_patch$` is anchored); the same scripts
  run on both and the host is passed as one argv. The default host, `claude-code`, never gets that
  argv, so Claude's generated config stays byte-identical. Event order is fixed (PreToolUse,
  UserPromptSubmit, SessionStart, Stop, then SubagentStop appended last) so a re-onboard is
  byte-stable. The stage writer is a non-blocking writer ordered after the entry gate; the stage
  marker recorder runs before the completion backstop so planning, specification and review markers
  are in the ledger when it folds the change.
- **Fail closed on Claude.** The three pre-mutation edit gates carry `onFailure: "block"` and a 10
  second timeout, so a gate that cannot start, times out, exits oddly or prints invalid output blocks
  the edit. This is rendered for Claude Code only (2.1.295 and later); Codex output is unchanged.
- **SubagentStop.** It always renders because stage isolation has no knob, and it costs nothing
  unless a `paqad-<stage>` agent runs. The matcher accepts `paqad-<stage>` (npm) and
  `paqad:paqad-<stage>` (plugin) and never a user's own or built-in subagents. It never blocks,
  since blocking on SubagentStop is undocumented.
- **The plugin chain.** Commands are rooted at the literal `${CLAUDE_PLUGIN_ROOT}/runtime`, which the
  host substitutes at hook time. A plugin-only SessionStart bootstrap runs first (it re-points the
  framework link and sets the PATH the other hooks rely on), `silent-update.mjs` is left out because
  the plugin channel updates itself, and no fail-closed policy is emitted yet: plugin hooks fail open
  until manual sign-off. When onboarding runs under the plugin, the npm chain is not written, so a
  repo has exactly one hook chain.
- **The renderer (`shared/native-hook-config.ts`).** One renderer writes every host's hook file.
  It is idempotent and non-destructive: the existing file is read tolerantly (single read, missing
  or unparseable means empty), keys outside the managed `hooks[event]` are untouched, retired
  commands are pruned before merging, existing groups come first and a paqad command already present
  is not added again. Retired hooks with no replacement (the old rule-script hook, the Codex
  record-only completion hook) are pruned by basename in any form, so the replacement never fires
  beside them; exact legacy strings (the old `.sh` and bare-path forms) are pruned too. Gemini keeps
  the single record-only `AfterAgent` hook, which always exits 0 and stays silent so its host never
  halts or retries.
- **Attribution.** Claude Code adds a `Co-Authored-By` trailer by default, which makes a git host list
  the AI vendor as a contributor. Under the `strip` policy the adapter writes the current
  `attribution` object (never the deprecated `includeCoAuthoredBy`), fills each sub-key only when it
  is absent so a team's own value survives, and keeps keys paqad does not know. Aider rewrites the
  git author and committer by default, so its three attribution keys are turned off together; the
  `.aider.conf.yml` merge uses the YAML document API to keep the team's comments, order and values,
  and a corrupt file is replaced with a valid one instead of failing onboarding. Nothing is written
  under the `keep` policy.
- **JetBrains AI Assistant.** It auto-applies every `.aiassistant/rules/*.md` and has no hooks, so it
  is a rules-only advisory adapter. MCP is off because the IDE configures MCP servers in its own
  settings, not from a project file.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
