import { BaseAdapter } from '../shared/base-adapter.js';

export class GeminiCliAdapter extends BaseAdapter {
  readonly type = 'gemini-cli' as const;

  protected configTemplateName() {
    return 'gemini.md.hbs';
  }
  protected configOutputPath() {
    return 'GEMINI.md';
  }
  protected skillsRoot() {
    return '.gemini/skills';
  }
  protected agentsRoot() {
    return '.gemini/agents';
  }
  protected hooksOutputPath() {
    return '.gemini/hooks.json';
  }
  protected mcpOutputPath() {
    return '.gemini/mcp.json';
  }
  protected cacheOutputPath() {
    return '.gemini/cache.json';
  }
  protected memoryOutputPath() {
    return '.gemini/memory.json';
  }
}
