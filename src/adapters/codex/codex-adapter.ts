import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildFullHookChain, buildNativeHookConfigFile } from '../shared/native-hook-config.js';

const CODEX_HOOKS_FILE = '.codex/hooks.json';

const CODEX_RETIRED_HOOK_FILES = ['verification-record.mjs', 'rule-script-enforce.mjs'];

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
    return '.codex/settings.hooks.json';
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

  protected override executedHookConfigFiles(): string[] {
    return ['hooks.json'];
  }

  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [
      ...base,
      buildNativeHookConfigFile({
        projectRoot: context.projectRoot,
        settingsPath: CODEX_HOOKS_FILE,
        chain: buildFullHookChain(this.type, process.env),
        pruneBasenames: CODEX_RETIRED_HOOK_FILES,
      }),
    ];
  }
}
