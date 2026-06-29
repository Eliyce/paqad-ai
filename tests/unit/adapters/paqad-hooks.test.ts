import { describe, expect, it } from 'vitest';

import {
  HOOK_COVERAGE_MATRIX,
  hookCommand,
  hasPreMutationBlock,
  PAQAD_LIVE_HOOKS,
  isLiveHookCapable,
} from '@/adapters/shared/paqad-hooks.js';
import { AdapterFactory } from '@/adapters/factory.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

describe('paqad live hook definition (#117 C-5)', () => {
  it('defines a decision-pause pre-tool gate and a completion hook from one source', () => {
    const ids = PAQAD_LIVE_HOOKS.map((hook) => hook.id);
    expect(ids).toContain('decision-pause-gate');
    expect(ids).toContain('verification-completion');

    const preTool = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'decision-pause-gate');
    expect(preTool?.event).toBe('pre-tool-mutation');
    expect(preTool?.mutatingToolMatcher).toBe('Edit|Write|NotebookEdit');
    // Cross-platform: a `.mjs` hook file, never the retired `.sh` (issue #240).
    expect(preTool?.hookFile).toBe('decision-pause-gate.mjs');

    const completion = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'verification-completion');
    expect(completion?.event).toBe('completion');
    expect(completion?.hookFile).toBe('verification-completion.mjs');
  });

  it('renders cross-platform commands: node + absolute path, no `~`, no `.sh` (#240)', () => {
    const command = hookCommand('agent-entry-gate.mjs', {
      PAQAD_FRAMEWORK_HOME: '/home/runner/.paqad-ai/current',
    } as NodeJS.ProcessEnv);
    expect(command).toBe('node "/home/runner/.paqad-ai/current/hooks/agent-entry-gate.mjs"');
    // No bare `~` (Windows shells don't expand it) and no `.sh`.
    expect(command).not.toContain('~');
    expect(command).not.toContain('.sh');
    expect(command.startsWith('node ')).toBe(true);
    // Windows-style home is normalised to forward slashes node accepts everywhere.
    const win = hookCommand('x.mjs', {
      PAQAD_FRAMEWORK_HOME: 'C:\\Users\\me\\.paqad-ai\\current',
    } as NodeJS.ProcessEnv);
    expect(win).toBe('node "C:/Users/me/.paqad-ai/current/hooks/x.mjs"');
  });

  it('tiers coverage honestly: only claude/codex/gemini are live (buildout F7b)', () => {
    expect(HOOK_COVERAGE_MATRIX['claude-code']).toBe('live-pre-and-completion');
    expect(HOOK_COVERAGE_MATRIX['codex-cli']).toBe('live-completion-only');
    expect(HOOK_COVERAGE_MATRIX['gemini-cli']).toBe('live-completion-only');
    // The previously-mislabelled hosts are advisory — no executed host hook.
    for (const advisory of [
      'cursor',
      'windsurf',
      'continue',
      'github-copilot',
      'junie',
      'aider',
      'antigravity',
    ]) {
      expect(HOOK_COVERAGE_MATRIX[advisory], advisory).toBe('advisory');
    }

    expect(isLiveHookCapable('claude-code')).toBe(true);
    expect(isLiveHookCapable('codex-cli')).toBe(true);
    expect(isLiveHookCapable('cursor')).toBe(false);
    expect(isLiveHookCapable('unknown-host')).toBe(false);

    // Pre-mutation blocking is Claude-only (the sole PreToolUse-capable host).
    expect(hasPreMutationBlock('claude-code')).toBe(true);
    expect(hasPreMutationBlock('codex-cli')).toBe(false);
    expect(hasPreMutationBlock('cursor')).toBe(false);
  });

  it('every adapter has a coverage entry, and advisory == no native hooks (grounded, anti-drift)', () => {
    for (const type of ADAPTER_TYPES) {
      const coverage = HOOK_COVERAGE_MATRIX[type];
      expect(coverage, type).toBeDefined();
      // The matrix must match the adapter's real capability: a `live` tier
      // requires capabilities.hooks; an advisory tier must NOT claim a hook the
      // host never wires. This catches a future re-mislabel (the #117 C-5 bug).
      const adapter = AdapterFactory.create(type);
      if (coverage === 'advisory') {
        // Advisory hosts either declare no hook capability, or (antigravity)
        // wire no executed native hook despite the base default.
        expect(isLiveHookCapable(type), type).toBe(false);
      } else {
        expect(adapter.capabilities.hooks, type).toBe(true);
      }
    }
  });
});
