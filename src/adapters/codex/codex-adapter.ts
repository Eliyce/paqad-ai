import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildNativeCompletionHookFile } from '../shared/native-completion-hook.js';

/** Codex CLI reads project-local hooks from `.codex/hooks.json` and fires `Stop`
 *  when a turn ends. https://developers.openai.com/codex/hooks */
const CODEX_HOOKS_FILE = '.codex/hooks.json';
const CODEX_COMPLETION_EVENT = 'Stop';

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
    // `.codex/hooks.json` is the file Codex actually executes — written below
    // with a real `Stop` hook. The base `installHooks` sidecar (resolved-artifact
    // metadata) goes to a paqad-internal path so it can never clobber it, mirroring
    // Claude's `.claude/settings.hooks.json`.
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

  // `.codex/hooks.json` is the file Codex executes; it now carries the absolute,
  // machine-specific `node "<abs>"` record-hook command, so it is per-machine.
  protected override executedHookConfigFiles(): string[] {
    return ['hooks.json'];
  }

  // Render Codex's native `Stop` hook so the verification-completion run (which
  // writes the evidence ledger) fires out of the box — the same coverage Claude
  // Code gets, with no change to AGENTS.md. The base entry file is untouched.
  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [
      ...base,
      buildNativeCompletionHookFile({
        projectRoot: context.projectRoot,
        settingsPath: CODEX_HOOKS_FILE,
        completionEvent: CODEX_COMPLETION_EVENT,
        adapterType: this.type,
      }),
    ];
  }
}
