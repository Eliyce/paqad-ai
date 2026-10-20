import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class AiAssistantAdapter extends BaseAdapter {
  readonly type = 'aiassistant' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: false,
    agents: false,
    hooks: false,
    mcp: false,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'aiassistant.md.hbs';
  }
  protected configOutputPath() {
    return '.aiassistant/rules/guidelines.md';
  }
  protected skillsRoot() {
    return '.aiassistant/skills';
  }
  protected agentsRoot() {
    return '.aiassistant/agents';
  }
  protected hooksOutputPath() {
    return '.aiassistant/hooks.json';
  }
  protected mcpOutputPath() {
    return '.aiassistant/mcp.json';
  }
  protected cacheOutputPath() {
    return '.aiassistant/cache.json';
  }
  protected memoryOutputPath() {
    return '.aiassistant/memory.json';
  }
}
