import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildNativeCompletionHookFile } from '../shared/native-completion-hook.js';

/** Gemini CLI reads hooks from `.gemini/settings.json` (under a `hooks` key) and
 *  fires `AfterAgent` when the agent loop ends. https://geminicli.com/docs/hooks/ */
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
    // Gemini executes hooks from `.gemini/settings.json` (written below). The base
    // `installHooks` sidecar metadata goes to a paqad-internal path so it never
    // clobbers the real settings file, mirroring Claude's `.claude/settings.hooks.json`.
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

  // Render Gemini's native `AfterAgent` hook so the verification-completion run
  // (which writes the evidence ledger) fires out of the box — the same coverage
  // Claude Code gets, with no change to GEMINI.md. The base entry file is untouched.
  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [
      ...base,
      buildNativeCompletionHookFile({
        projectRoot: context.projectRoot,
        settingsPath: GEMINI_SETTINGS_FILE,
        completionEvent: GEMINI_COMPLETION_EVENT,
      }),
    ];
  }
}
