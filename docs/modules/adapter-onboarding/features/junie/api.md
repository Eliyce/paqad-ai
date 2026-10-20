# JetBrains Junie — API View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `junie`

Internal TypeScript class only. No CLI verb of its own: `paqad-ai onboard`, `join` and `update` call it through `AdapterFactory.create('junie')`.

## `src/adapters/junie/junie-adapter.ts`

```ts
export class JunieAdapter extends BaseAdapter {
  readonly type: 'junie';
}
```

The surface comes from `BaseAdapter` (`src/adapters/adapter.interface.ts`):

| Method | JetBrains Junie path |
| --- | --- |
| `getConfigPath()` | `.junie/AGENTS.md` |
| `generateSkills(skills)` | `.junie/skills/` |
| `generateAgents(agents)` | `.junie/agents/` |
| `installHooks(hooks)` | `.junie/hooks.json` |
| `installMcp(mcpConfigs, profile)` | returns nothing |
| `configureCaching(profile)` | `.junie/cache.json` |
| `configureMemory(profile)` | `.junie/memory.json` |

## MCP

paqad never writes `.junie/mcp/mcp.json`. Junie reads that file, and people add their own servers to it, so it belongs to them. Recommendations go to `.paqad/mcp-recommendations.json`, written once per project by the onboarding orchestrator. A `.junie/mcp/mcp.json` that an older paqad wrote is removed by `cleanupLegacyMcpFiles` (`src/mcp/cleanup.ts`) only when it is clearly paqad's own list.
