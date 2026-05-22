import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class JunieAdapter extends BaseAdapter {
  readonly type = 'junie' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: false,
    agents: false,
    hooks: false,
    mcp: true,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'junie.md.hbs';
  }
  protected configOutputPath() {
    return '.junie/AGENTS.md';
  }
  protected skillsRoot() {
    return '.junie/skills';
  }
  protected agentsRoot() {
    return '.junie/agents';
  }
  protected hooksOutputPath() {
    return '.junie/hooks.json';
  }
  protected mcpOutputPath() {
    return '.junie/mcp/mcp.json';
  }
  protected cacheOutputPath() {
    return '.junie/cache.json';
  }
  protected memoryOutputPath() {
    return '.junie/memory.json';
  }
}
