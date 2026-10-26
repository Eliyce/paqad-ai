import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('runtime/hooks/capability-gate.mjs — completion seam asks the ledger even with no background_tasks', () => {
  const DEFER = resolve(process.cwd(), 'dist/stage-evidence/completion-deferred.js');
  let projectRoot: string;
  let restoreEnv: string | undefined;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const calls: unknown[] = [];

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-defer-'));
    restoreEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = projectRoot;
    calls.length = 0;
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.resetModules();
    vi.doMock(GATE, () => ({
      runCapabilityGate: async () => ({ block: true, summary: '✗ blocked by kernel.' }),
    }));
    vi.doMock(DEFER, () => ({
      deferCompletionForBackgroundStage: (input: unknown) => {
        calls.push(input);
        return { deferred: true, reason: 'stage agent running in background', tasks: 1 };
      },
    }));
  });

  afterEach(() => {
    writeSpy.mockRestore();
    if (restoreEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = restoreEnv;
    rmSync(projectRoot, { recursive: true, force: true });
    vi.doUnmock(GATE);
    vi.doUnmock(DEFER);
  });

  it('AC-28: a Stop with no background_tasks is deferred when the ledger shows a live stage agent', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const code = await main(payload(false), 'completion');

    expect(calls).toHaveLength(1);
    expect(code).toBe(0);
  });

  it('INV-2: the pre-mutation seam never consults the deferral and keeps blocking', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const code = await main(payload(false), 'pre-mutation');

    expect(calls).toHaveLength(0);
    expect(code).toBe(2);
  });
});
