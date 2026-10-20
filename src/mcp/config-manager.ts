import { PATHS } from '@/core/constants/paths.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { McpConfigOutput, McpRecommendations } from '@/core/types/mcp.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

import { McpServerRegistry } from './server-registry.js';

export const LEGACY_MCP_OUTPUT_PATHS: Record<AdapterType, string> = {
  'claude-code': '.claude/settings.mcp.json',
  'codex-cli': '.codex/mcp.json',
  antigravity: '.antigravity/mcp.json',
  'gemini-cli': '.gemini/mcp.json',
  junie: '.junie/mcp/mcp.json',
  cursor: '.cursor/mcp.json',
  'github-copilot': '.vscode/mcp.json',
  windsurf: '.windsurf/mcp.json',
  continue: '.continue/mcp.json',
  aider: 'aider.mcp.json',
  aiassistant: '.aiassistant/mcp.json',
};

export class McpConfigManager {
  private readonly registry = new McpServerRegistry();

  generate(profile: ProjectProfile): McpConfigOutput {
    const why = `${getPrimaryStack(profile)} project`;
    const recommendations: McpRecommendations = {
      servers: this.registry.forProfile(profile).map((server) => ({
        name: server.name,
        provides: server.provides,
        replaces: server.replaces,
        why,
      })),
    };

    return {
      path: PATHS.MCP_RECOMMENDATIONS,
      content: JSON.stringify(recommendations, null, 2),
    };
  }
}
