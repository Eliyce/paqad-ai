import { BaseAdapter } from '../shared/base-adapter.js';

export class CodexCliAdapter extends BaseAdapter {
  readonly type = 'codex-cli' as const;

  protected configTemplateName() {
    return 'agents.md.hbs';
  }
  protected configOutputPath() {
    return 'AGENTS.md';
  }
  protected skillsRoot() {
    return '.codex/skills';
  }
  protected agentsRoot() {
    return '.codex/agents';
  }
  protected hooksOutputPath() {
    return '.codex/hooks.json';
  }
  protected mcpOutputPath() {
    return '.codex/mcp.json';
  }
  protected cacheOutputPath() {
    return '.codex/cache.json';
  }
  protected memoryOutputPath() {
    return '.codex/memory.json';
  }
}
