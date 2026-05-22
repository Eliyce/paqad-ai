import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class CursorAdapter extends BaseAdapter {
  readonly type = 'cursor' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: true,
    agents: true,
    hooks: false,
    mcp: true,
    caching: true,
    memory: true,
  };

  protected configTemplateName() {
    return 'cursor.md.hbs';
  }
  protected configOutputPath() {
    return '.cursor/rules/paqad.mdc';
  }
  protected skillsRoot() {
    return '.cursor/skills';
  }
  protected agentsRoot() {
    return '.cursor/agents';
  }
  protected hooksOutputPath() {
    return '.cursor/hooks.json';
  }
  protected mcpOutputPath() {
    return '.cursor/mcp.json';
  }
  protected cacheOutputPath() {
    return '.cursor/cache.json';
  }
  protected memoryOutputPath() {
    return '.cursor/memory.json';
  }
}
