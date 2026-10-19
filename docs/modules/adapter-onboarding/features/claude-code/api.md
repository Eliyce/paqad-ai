# Claude Code (CLAUDE.md) — API View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `claude-code`

Internal TypeScript class only. No CLI verb of its own: `paqad-ai onboard`, `join` and `update` call it through `AdapterFactory.create('claude-code')`.

## `src/adapters/claude/claude-adapter.ts`

```ts
export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type: 'claude-code';
  generateConfig(context: AdapterContext): Promise<GeneratedFile[]>;
}
```

`generateConfig` returns the base entry file (`CLAUDE.md`) plus `.claude/settings.json`, the file Claude Code runs hooks from.

The rest of the surface comes from `BaseAdapter` (`src/adapters/adapter.interface.ts`):

| Method | Claude Code path |
| --- | --- |
| `getConfigPath()` | `CLAUDE.md` |
| `generateSkills(skills)` | `.claude/skills/` |
| `generateAgents(agents)` | `.claude/agents/` |
| `installHooks(hooks)` | `.claude/settings.hooks.json` |
| `getMcpPath()` | `.mcp.json`, read only, used by the doctor MCP check |
| `installMcp(mcpConfigs, profile)` | returns nothing (issue #622) |
| `configureCaching(profile)` | `.claude/cache.json` |
| `configureMemory(profile)` | `.claude/memory.json` |

## MCP (issue #622)

paqad never writes a tool's MCP config file. `getMcpPath()` returns `.mcp.json`, the project MCP file Claude Code reads, so `paqad-ai doctor` can list the servers found there next to the recommended ones. Recommendations are written once per project to `.paqad/mcp-recommendations.json` by the onboarding orchestrator, not by this adapter.
