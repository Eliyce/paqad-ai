export const MCP_SERVER_TYPES = [
  'laravel-boost',
  'dart-mcp',
  'database-inspector',
  'figma',
  'vite-inspector',
  'react-router-mcp',
  'vue-router-mcp',
  'tailwind-mcp',
] as const;
export type McpServerType = (typeof MCP_SERVER_TYPES)[number];

export interface McpServerConfig {
  name: McpServerType | string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface McpServerDefinition {
  name: McpServerType;
  stacks: string[];
  capabilities: string[];
  provides: string[];
  replaces: string[];
}

export interface McpConfigOutput {
  path: string;
  content: string;
}

export type DataSourceType = 'mcp' | 'script' | 'cached-skill' | 'llm-read';

export interface DataSource {
  type: DataSourceType;
  server?: string;
  script?: string;
  reason?: string;
  estimated_token_savings?: number;
}
