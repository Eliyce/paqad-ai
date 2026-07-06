import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AC-5 — the capability-gate completion (Stop) seam honors the loop guard: a block
// downgrades to a non-blocking advisory once Claude marks the Stop as a
// continuation (`stop_hook_active`). The pre-mutation seam always keeps its teeth.
// The compiled kernel executor is mocked (as in verify-backstop.test.ts) so the
// exit-code decision is asserted without a built dist.
const GATE = resolve(process.cwd(), 'dist/kernel/gate.js');

function payload(stopHookActive: boolean): string {
  return JSON.stringify({ session_id: 's', stop_hook_active: stopHookActive });
}

describe('runtime/hooks/capability-gate.mjs — Stop-seam loop guard', () => {
  let projectRoot: string;
  let stderr: string;
  let restoreEnv: string | undefined;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A fresh tmp project: no disable signal (enabled) and stages_mode defaults to
    // strict, so seamHasWork() is true and main() reaches the kernel executor.
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-loop-'));
    restoreEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = projectRoot;
    stderr = '';
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });
    vi.resetModules();
    vi.doMock(GATE, () => ({
      runCapabilityGate: async () => ({ block: true, summary: '✗ blocked by kernel.' }),
    }));
  });

  afterEach(() => {
    writeSpy.mockRestore();
    if (restoreEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = restoreEnv;
    rmSync(projectRoot, { recursive: true, force: true });
    vi.doUnmock(GATE);
  });

  it('completion seam + stop_hook_active: downgrades block to exit 0 with an advisory', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const code = await main(payload(true), 'completion');

    expect(code).toBe(0);
    expect(stderr).toContain('✗ blocked by kernel.');
    expect(stderr).toContain('not blocking again');
  });

  it('completion seam without stop_hook_active: still hard-blocks (exit 2)', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const code = await main(payload(false), 'completion');

    expect(code).toBe(2);
    expect(stderr).toContain('✗ blocked by kernel.');
    expect(stderr).not.toContain('not blocking again');
  });

  it('pre-mutation seam keeps its teeth even under stop_hook_active (never loops)', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const code = await main(payload(true), 'pre-mutation');

    expect(code).toBe(2);
    expect(stderr).not.toContain('not blocking again');
  });
});
