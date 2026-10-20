# GitHub Copilot — API View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `github-copilot`

Internal TypeScript class only. No CLI verb of its own: `paqad-ai onboard`, `join` and `update` call it through `AdapterFactory.create('github-copilot')`.

## `src/adapters/github-copilot/github-copilot-adapter.ts`

```ts
export class GithubCopilotAdapter extends BaseAdapter {
  readonly type: 'github-copilot';
}
```

The surface comes from `BaseAdapter` (`src/adapters/adapter.interface.ts`):

| Method | GitHub Copilot path |
| --- | --- |
| `getConfigPath()` | `.github/copilot-instructions.md` |
| `generateSkills(skills)` | `.github/skills/` |
| `generateAgents(agents)` | `.github/agents/` |
| `installHooks(hooks)` | `.github/hooks.json` |
| `installMcp(mcpConfigs, profile)` | returns nothing |
| `configureCaching(profile)` | `.github/cache.json` |
| `configureMemory(profile)` | `.github/memory.json` |

## MCP

paqad never writes `.vscode/mcp.json`. VS Code and Copilot read that file, and people add their own servers to it, so it belongs to them. Recommendations go to `.paqad/mcp-recommendations.json`, written once per project by the onboarding orchestrator. A `.vscode/mcp.json` that an older paqad wrote is removed by `cleanupLegacyMcpFiles` (`src/mcp/cleanup.ts`) only when it is clearly paqad's own list.
