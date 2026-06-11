import { describe, expect, it } from 'vitest';

import {
  HOOK_COVERAGE_MATRIX,
  PAQAD_LIVE_HOOKS,
  isLiveHookCapable,
} from '@/adapters/shared/paqad-hooks.js';

describe('paqad live hook definition (#117 C-5)', () => {
  it('defines a decision-pause pre-tool gate and a completion hook from one source', () => {
    const ids = PAQAD_LIVE_HOOKS.map((hook) => hook.id);
    expect(ids).toContain('decision-pause-gate');
    expect(ids).toContain('verification-completion');

    const preTool = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'decision-pause-gate');
    expect(preTool?.event).toBe('pre-tool-mutation');
    expect(preTool?.mutatingToolMatcher).toBe('Edit|Write|NotebookEdit');
    expect(preTool?.script).toContain('decision-pause-gate.sh');

    const completion = PAQAD_LIVE_HOOKS.find((hook) => hook.id === 'verification-completion');
    expect(completion?.event).toBe('completion');
    expect(completion?.script).toContain('verification-completion.mjs');
  });

  it('marks the hook-capable adapters live+backstop and aider/antigravity backstop-only', () => {
    expect(HOOK_COVERAGE_MATRIX['claude-code']).toBe('live+backstop');
    expect(HOOK_COVERAGE_MATRIX['codex-cli']).toBe('live+backstop');
    expect(HOOK_COVERAGE_MATRIX['gemini-cli']).toBe('live+backstop');
    expect(HOOK_COVERAGE_MATRIX.cursor).toBe('live+backstop');
    expect(HOOK_COVERAGE_MATRIX.windsurf).toBe('live+backstop');
    expect(HOOK_COVERAGE_MATRIX.aider).toBe('backstop-only');
    expect(HOOK_COVERAGE_MATRIX.antigravity).toBe('backstop-only');

    expect(isLiveHookCapable('claude-code')).toBe(true);
    expect(isLiveHookCapable('aider')).toBe(false);
    expect(isLiveHookCapable('unknown-host')).toBe(false);
  });
});
