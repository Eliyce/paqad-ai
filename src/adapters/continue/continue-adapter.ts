import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class ContinueAdapter extends BaseAdapter {
  readonly type = 'continue' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: true,
    agents: false,
    hooks: false,
    mcp: true,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'continue.md.hbs';
  }
  protected configOutputPath() {
    return '.continue/rules/paqad.md';
  }
  protected skillsRoot() {
    return '.continue/prompts';
  }
  protected agentsRoot() {
    return '.continue/agents';
  }
  protected hooksOutputPath() {
    return '.continue/hooks.json';
  }
  protected mcpOutputPath() {
    return '.continue/mcp.json';
  }
  protected cacheOutputPath() {
    return '.continue/cache.json';
  }
  protected memoryOutputPath() {
    return '.continue/memory.json';
  }
}
