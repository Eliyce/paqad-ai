import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class WindsurfAdapter extends BaseAdapter {
  readonly type = 'windsurf' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: true,
    agents: true,
    hooks: false,
    mcp: true,
    caching: true,
    memory: true,
  };

  protected configTemplateName() {
    return 'windsurf.md.hbs';
  }
  protected configOutputPath() {
    return '.windsurfrules';
  }
  protected skillsRoot() {
    return '.windsurf/skills';
  }
  protected agentsRoot() {
    return '.windsurf/agents';
  }
  protected hooksOutputPath() {
    return '.windsurf/hooks.json';
  }
  protected mcpOutputPath() {
    return '.windsurf/mcp.json';
  }
  protected cacheOutputPath() {
    return '.windsurf/cache.json';
  }
  protected memoryOutputPath() {
    return '.windsurf/memory.json';
  }
}
