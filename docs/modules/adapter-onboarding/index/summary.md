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
