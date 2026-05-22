import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class AiderAdapter extends BaseAdapter {
  readonly type = 'aider' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: false,
    agents: false,
    hooks: false,
    mcp: false,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'aider.md.hbs';
  }
  protected configOutputPath() {
    return 'CONVENTIONS.md';
  }
  protected skillsRoot() {
    return '.aider/skills';
  }
  protected agentsRoot() {
    return '.aider/agents';
  }
  protected hooksOutputPath() {
    return '.aider/hooks.json';
  }
  protected mcpOutputPath() {
    return 'aider.mcp.json';
  }
  protected cacheOutputPath() {
    return '.aider/cache.json';
  }
  protected memoryOutputPath() {
    return '.aider/memory.json';
  }
}
