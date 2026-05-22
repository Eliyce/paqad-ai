import type { AdapterType } from '@/core/types/adapter.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { McpConfigOutput, McpServerDefinition } from '@/core/types/mcp.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

import { McpServerRegistry } from './server-registry.js';

const ADAPTER_OUTPUT_PATHS: Record<AdapterType, string> = {
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
};

export class McpConfigManager {
  private readonly registry = new McpServerRegistry();

  generate(profile: ProjectProfile, adapter: AdapterType): McpConfigOutput {
    const servers = this.registry.forProfile(profile);

    return {
      path: ADAPTER_OUTPUT_PATHS[adapter],
      content: JSON.stringify(
        {
          mcpServers: Object.fromEntries(
            servers.map((server) => [server.name, buildServerConfig(server, profile)]),
          ),
        },
        null,
        2,
      ),
    };
  }
}

function buildServerConfig(
  server: McpServerDefinition,
  profile: ProjectProfile,
): Record<string, unknown> {
  const profileEntry = profile.mcp.servers.find((entry) => entry.name === server.name);
  const fromProfile = profileEntry?.config ?? {};
  const stack = getPrimaryStack(profile);

  return {
    enabled: profileEntry?.enabled ?? true,
    stack,
    provides: server.provides,
    replaces: server.replaces,
    ...fromProfile,
  };
}
