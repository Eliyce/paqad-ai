import type { DataSource } from '@/core/types/mcp.js';

const MCP_MAPPING: Record<string, string> = {
  routes: 'laravel-boost',
  models: 'laravel-boost',
  services: 'laravel-boost',
  schema: 'database-inspector',
  indexes: 'database-inspector',
  'foreign-keys': 'database-inspector',
  'query-plans': 'database-inspector',
  widgets: 'dart-mcp',
  dependencies: 'dart-mcp',
  'design-specs': 'figma',
};

const SCRIPT_MAPPING: Record<string, string> = {
  routes: 'extract-routes.sh',
  models: 'extract-models.sh',
  events: 'extract-events.sh',
  'error-codes': 'extract-error-codes.sh',
};

export class DataRetrievalDecider {
  constructor(
    private readonly availableMcp: string[] = [],
    private readonly availableScripts: string[] = [],
  ) {}

  decide(dataNeeded: string): DataSource {
    const mcpProvider = this.findMcpProvider(dataNeeded);
    if (mcpProvider) {
      return {
        type: 'mcp',
        server: mcpProvider,
        estimated_token_savings: 1200,
      };
    }

    const script = this.findScript(dataNeeded);
    if (script) {
      return {
        type: 'script',
        script,
        estimated_token_savings: 400,
      };
    }

    return {
      type: 'llm-read',
      reason: `No MCP or script available for: ${dataNeeded}`,
      estimated_token_savings: 0,
    };
  }

  private findMcpProvider(dataNeeded: string): string | undefined {
    const server = MCP_MAPPING[dataNeeded];
    return server && this.availableMcp.includes(server) ? server : undefined;
  }

  private findScript(dataNeeded: string): string | undefined {
    const script = SCRIPT_MAPPING[dataNeeded];
    return script && this.availableScripts.includes(script) ? script : undefined;
  }
}
