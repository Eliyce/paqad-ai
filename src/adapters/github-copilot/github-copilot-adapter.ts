import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

export class GithubCopilotAdapter extends BaseAdapter {
  readonly type = 'github-copilot' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: false,
    agents: false,
    hooks: false,
    mcp: true,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'copilot.md.hbs';
  }
  protected configOutputPath() {
    return '.github/copilot-instructions.md';
  }
  protected skillsRoot() {
    return '.github/skills';
  }
  protected agentsRoot() {
    return '.github/agents';
  }
  protected hooksOutputPath() {
    return '.github/hooks.json';
  }
  protected mcpOutputPath() {
    return '.vscode/mcp.json';
  }
  protected cacheOutputPath() {
    return '.github/cache.json';
  }
  protected memoryOutputPath() {
    return '.github/memory.json';
  }
}
