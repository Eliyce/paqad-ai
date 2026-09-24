import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Issue #579 (AC-17 / AC-18) — the first-frontend-edit reminder is MODEL-facing only: on the
// allow path it goes out as PreToolUse hookSpecificOutput.additionalContext, on the block path it
// is appended to the stderr reason, and no user-facing systemMessage is ever emitted. The dist
// executor is mocked, as in capability-gate-loop.test.ts.
const GATE = resolve(process.cwd(), 'dist/kernel/gate.js');
const LINE =
  'This is a frontend change and visual evidence is on. Before review, run `paqad-ai visual-evidence run` or attach screenshots with `paqad-ai visual-evidence attach`.';

describe('runtime/hooks/capability-gate.mjs — model-facing context', () => {
  let projectRoot: string;
  let stdout: string;
  let stderr: string;
  let restoreEnv: string | undefined;
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  function mockGate(result: Record<string, unknown>): void {
    vi.doMock(GATE, () => ({ runCapabilityGate: async () => result }));
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-ctx-'));
    restoreEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = projectRoot;
    stdout = '';
    stderr = '';
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });
    vi.resetModules();
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    if (restoreEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = restoreEnv;
    rmSync(projectRoot, { recursive: true, force: true });
    vi.doUnmock(GATE);
  });

  it('AC-17: allow path emits the reminder as additionalContext and no systemMessage', async () => {
    mockGate({ block: false, summary: '', narration: '', context: LINE });
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(0);
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    expect(payload).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: LINE },
    });
    expect(payload.systemMessage).toBeUndefined();
    expect(stderr).toBe('');
  });

  it('AC-17: allow path with no context stays silent', async () => {
    mockGate({ block: false, summary: '', narration: '', context: '' });
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(0);
    expect(stdout).toBe('');
  });

  it('never emits context on the completion seam', async () => {
    mockGate({ block: false, summary: '', narration: '', context: LINE });
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'completion')).toBe(0);
    expect(stdout).toBe('');
  });

  it('AC-18: block path appends the reminder to the reason', async () => {
    mockGate({ block: true, summary: '✗ blocked by kernel.', narration: '', context: LINE });
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(2);
    expect(stderr).toBe(`✗ blocked by kernel.\n${LINE}\n`);
    expect(stdout).toBe('');
  });
});
