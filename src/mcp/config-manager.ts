import { PATHS } from '@/core/constants/paths.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { McpConfigOutput, McpRecommendations } from '@/core/types/mcp.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

import { McpServerRegistry } from './server-registry.js';

/**
 * Every per-host path older paqad versions wrote MCP config to (issue #622). paqad no longer
 * writes any of them: these files belong to the tools that read them. The table is kept only
 * so `cleanupLegacyMcpFiles` knows which files paqad may have left behind.
 */
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
  aider: 'aider.mcp.json', // unreachable; capabilities.mcp = false
  aiassistant: '.aiassistant/mcp.json', // unreachable; capabilities.mcp = false
};

export class McpConfigManager {
  private readonly registry = new McpServerRegistry();

  /**
   * The MCP servers recommended for this project, written to paqad's own
   * `.paqad/mcp-recommendations.json`. Never a host config path (issue #622).
   */
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
