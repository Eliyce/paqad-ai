import { BaseAdapter } from '../shared/base-adapter.js';

export class AntigravityAdapter extends BaseAdapter {
  readonly type = 'antigravity' as const;

  protected configTemplateName() {
    return 'antigravity.md.hbs';
  }
  protected configOutputPath() {
    return 'ANTIGRAVITY.md';
  }
  protected skillsRoot() {
    return '.antigravity/skills';
  }
  protected agentsRoot() {
    return '.antigravity/agents';
  }
  protected hooksOutputPath() {
    return '.antigravity/hooks.json';
  }
  protected mcpOutputPath() {
    return '.antigravity/mcp.json';
  }
  protected cacheOutputPath() {
    return '.antigravity/cache.json';
  }
  protected memoryOutputPath() {
    return '.antigravity/memory.json';
  }
}
