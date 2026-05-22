import { BaseAdapter } from '../shared/base-adapter.js';

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type = 'claude-code' as const;

  protected configTemplateName() {
    return 'claude.md.hbs';
  }
  protected configOutputPath() {
    return 'CLAUDE.md';
  }
  protected skillsRoot() {
    return '.claude/skills';
  }
  protected agentsRoot() {
    return '.claude/agents';
  }
  protected hooksOutputPath() {
    return '.claude/settings.hooks.json';
  }
  protected mcpOutputPath() {
    return '.claude/settings.mcp.json';
  }
  protected cacheOutputPath() {
    return '.claude/cache.json';
  }
  protected memoryOutputPath() {
    return '.claude/memory.json';
  }
}
