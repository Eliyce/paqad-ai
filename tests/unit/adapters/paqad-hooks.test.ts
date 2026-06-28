import { describe, expect, it } from 'vitest';

import {
  HOOK_COVERAGE_MATRIX,
  hookCommand,
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
