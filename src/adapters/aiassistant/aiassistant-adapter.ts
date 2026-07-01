import type { AdapterCapabilities } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

/**
 * JetBrains AI Assistant (issue #219). AI Assistant auto-applies every `*.md`
 * under `.aiassistant/rules/` at the start of a conversation — the analog of
 * `CLAUDE.md` / `.junie/AGENTS.md`. It has no hook / lifecycle system, so the
 * `.paqad/.agent-entry-loaded` sentinel gate cannot bind here: this is a soft,
 * rules-only adapter (advisory hook coverage), exactly like `junie`.
 *
 * MCP is intentionally off. JetBrains AI Assistant configures MCP servers in the
 * IDE settings, not from a project file, so emitting a project-level `mcp.json`
 * would write an artifact no host reads. Modeled on `aider` (config-only).
 */
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
    return '.aiassistant/mcp.json'; // unreachable; capabilities.mcp = false
  }
  protected cacheOutputPath() {
    return '.aiassistant/cache.json';
  }
  protected memoryOutputPath() {
    return '.aiassistant/memory.json';
  }
}
