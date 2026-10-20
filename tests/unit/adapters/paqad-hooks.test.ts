import { describe, expect, it } from 'vitest';

import {
  HOOK_COVERAGE_MATRIX,
  hookCommand,
  hasPreMutationBlock,
  NATIVE_HOOK_EVENTS,
  PAQAD_LIVE_HOOKS,
  isLiveHookCapable,
} from '@/adapters/shared/paqad-hooks.js';
import { AdapterFactory } from '@/adapters/factory.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

describe('paqad live hook definition', () => {
  it('defines the full ordered chain — entry gate, decision-pause, and completion — from one source', () => {
    const ids = PAQAD_LIVE_HOOKS.map((hook) => hook.id);
    expect(ids).toContain('agent-entry-gate');
    expect(ids).toContain('decision-pause-gate');
    expect(ids).toContain('verification-completion');

    const preTool = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'decision-pause-gate');
    expect(preTool?.event).toBe('pre-tool-mutation');
    expect(NATIVE_HOOK_EVENTS['claude-code'].mutatingMatcher).toBe('Edit|Write|NotebookEdit');
    expect(NATIVE_HOOK_EVENTS['codex-cli'].mutatingMatcher).toBe('^apply_patch$');
    expect(preTool?.hookFile).toBe('decision-pause-gate.mjs');

    const completion = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'verification-completion');
    expect(completion?.event).toBe('completion');
    expect(completion?.hookFile).toBe('verification-completion.mjs');
  });

  it('renders cross-platform commands: node + absolute path, no `~`, no `.sh`', () => {
    const command = hookCommand('agent-entry-gate.mjs', {
      PAQAD_FRAMEWORK_HOME: '/home/runner/.paqad-ai/current',
    } as NodeJS.ProcessEnv);
    expect(command).toBe('node "/home/runner/.paqad-ai/current/hooks/agent-entry-gate.mjs"');
    expect(command).not.toContain('~');
    expect(command).not.toContain('.sh');
    expect(command.startsWith('node ')).toBe(true);
    const win = hookCommand('x.mjs', {
      PAQAD_FRAMEWORK_HOME: 'C:\\Users\\me\\.paqad-ai\\current',
    } as NodeJS.ProcessEnv);
    expect(win).toBe('node "C:/Users/me/.paqad-ai/current/hooks/x.mjs"');
  });

  it('tiers coverage honestly: claude/codex are pre-and-completion, gemini completion-only', () => {
    expect(HOOK_COVERAGE_MATRIX['claude-code']).toBe('live-pre-and-completion');
    expect(HOOK_COVERAGE_MATRIX['codex-cli']).toBe('live-pre-and-completion');
    expect(HOOK_COVERAGE_MATRIX['gemini-cli']).toBe('live-completion-only');
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

    expect(hasPreMutationBlock('claude-code')).toBe(true);
    expect(hasPreMutationBlock('codex-cli')).toBe(true);
    expect(hasPreMutationBlock('gemini-cli')).toBe(false);
    expect(hasPreMutationBlock('cursor')).toBe(false);
  });

  it('every adapter has a coverage entry, and advisory == no native hooks (grounded, anti-drift)', () => {
    for (const type of ADAPTER_TYPES) {
      const coverage = HOOK_COVERAGE_MATRIX[type];
      expect(coverage, type).toBeDefined();
      const adapter = AdapterFactory.create(type);
      if (coverage === 'advisory') {
        expect(isLiveHookCapable(type), type).toBe(false);
      } else {
        expect(adapter.capabilities.hooks, type).toBe(true);
      }
    }
  });
});
