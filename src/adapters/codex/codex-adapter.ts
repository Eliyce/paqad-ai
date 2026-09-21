import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildFullHookChain, buildNativeHookConfigFile } from '../shared/native-hook-config.js';
import { isStageIsolationOn } from '@/stage-isolation/mode.js';

/** Codex CLI reads project-local hooks from `.codex/hooks.json` and fires the same
 *  lifecycle events Claude Code does — SessionStart, UserPromptSubmit, PreToolUse
 *  (matched on `tool_name`), and Stop. https://developers.openai.com/codex/hooks */
const CODEX_HOOKS_FILE = '.codex/hooks.json';

// Retired hooks pruned from an existing `.codex/hooks.json` on re-onboard: the old
// record-only completion hook (Codex now renders the full blocking chain, issue
// #566, so `verification-record.mjs` in ANY form is removed from its `Stop`), and
// the capability-kernel-subsumed `rule-script-enforce.mjs`. Basename prune covers
// both the Windows-broken bare-`~` form (#240) and the absolute `node "<abs>"` form.
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
    // `.codex/hooks.json` is the file Codex actually executes — written below with
    // the full hook chain. The base `installHooks` sidecar (resolved-artifact
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

  // `.codex/hooks.json` is the file Codex executes; it carries the absolute,
  // machine-specific `node "<abs>"` commands, so it is per-machine.
  protected override executedHookConfigFiles(): string[] {
    return ['hooks.json'];
  }

  // Render Codex's full lifecycle hook chain (SessionStart, UserPromptSubmit,
  // PreToolUse `^apply_patch$`, Stop) so the same feature-development gates and
  // completion verification Claude Code gets fire on Codex too (issue #566), with no
  // change to AGENTS.md. The base entry file is untouched — enforcement lives in the
  // hook layer, never in entry-file prose.
  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [
      ...base,
      buildNativeHookConfigFile({
        projectRoot: context.projectRoot,
        settingsPath: CODEX_HOOKS_FILE,
        // Issue #567 — include the SubagentStop hook only when stage isolation is on, so a
        // default-off project's .codex/hooks.json is byte-identical to before this feature.
        chain: buildFullHookChain(this.type, process.env, {
          stageIsolation: isStageIsolationOn(context.projectRoot),
        }),
        pruneBasenames: CODEX_RETIRED_HOOK_FILES,
      }),
    ];
  }
}
