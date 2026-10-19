# MCP Configuration

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `mcp-config`

## Purpose

Recommends stack-scoped MCP servers in `.paqad/mcp-recommendations.json`
and never writes another tool's MCP config file. Removes only the
legacy MCP files older paqad versions wrote (issue #622).

- **Recommendations.** `McpConfigManager.generate(profile)` returns one file,
  `.paqad/mcp-recommendations.json`, shaped `{ "servers": [{ "name", "provides", "replaces", "why" }] }`.
  It carries no `command`, `url` or `type`: paqad suggests servers, it does not configure them.
  Onboard and join write it once when any selected host supports MCP (join only when it is git-ignored).
- **Legacy cleanup.** `cleanupLegacyMcpFiles(projectRoot, { canDelete? })` (`src/mcp/cleanup.ts`)
  visits every path in `LEGACY_MCP_OUTPUT_PATHS`. It deletes a file only when it parses as a JSON
  object whose top-level keys are `resolved_artifacts` (a list, required) and optionally
  `mcpServers`, and every `mcpServers` entry is a plain object with none of `command`, `url`,
  `type`, `serverUrl`, `args`, `env`, `headers` or `transport`. Every other file is kept
  byte-identical. A kept file that carries the `resolved_artifacts` marker is logged to
  `.paqad/logs/mcp-cleanup.log`; an unmarked file is the user's and is not logged.
  Onboard and update run it on the project root; join passes
  `canDelete` = "git-ignored", so a tracked file is left for onboard or update. It never throws.
- **Doctor.** The `MCP servers (recommended)` check is always `info`: it lists the servers
  recommended for the stack and, read-only, the servers in the root `.mcp.json`. An `info` check
  never changes the overall doctor status.

## Source Footprint

- `src/mcp`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

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
