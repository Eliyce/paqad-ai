import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildNativeCompletionHookFile } from '../shared/native-hook-config.js';

const GEMINI_SETTINGS_FILE = '.gemini/settings.json';
const GEMINI_COMPLETION_EVENT = 'AfterAgent';

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
    return '.gemini/settings.hooks.json';
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

  protected override executedHookConfigFiles(): string[] {
    return ['settings.json'];
  }

  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [
      ...base,
      buildNativeCompletionHookFile({
        projectRoot: context.projectRoot,
        settingsPath: GEMINI_SETTINGS_FILE,
        completionEvent: GEMINI_COMPLETION_EVENT,
        adapterType: this.type,
      }),
    ];
  }
}
