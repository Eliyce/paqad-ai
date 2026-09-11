import { describe, expect, it } from 'vitest';

import { runStages } from '@/checks/scheduler.js';
import type { ScheduledCommand } from '@/checks/scheduler.js';
import type { DeliveryShell } from '@/delivery/runner.js';

const COMMANDS: ScheduledCommand[] = [
  { logical_command: 'format', command: 'fmtbin', stage: 1 },
  { logical_command: 'build', command: 'buildbin', stage: 2 },
  { logical_command: null, command: 'shellbin', stage: 2 },
  { logical_command: 'test', command: 'testbin', stage: 3 },
];

// The scheduler (issue #554, Part C / AC-5): format serial, build+shell overlapped, test alone,
// every stage runs even after a red command.
describe('runStages (AC-5)', () => {
  it('serializes stage 1, overlaps stage 2, runs test last, and does not stop on a red format', async () => {
    const events: string[] = [];
    let stage2Started = 0;
    let releaseBarrier: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const shell: DeliveryShell = {
      async run(bin) {
        events.push(`start:${bin}`);
        if (bin === 'fmtbin') {
          events.push('end:fmtbin');
          return { stdout: '', stderr: 'format failed', exitCode: 1 };
        }
        if (bin === 'buildbin' || bin === 'shellbin') {
          stage2Started += 1;
          if (stage2Started >= 2) releaseBarrier();
          await barrier;
          events.push(`end:${bin}`);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        events.push(`end:${bin}`);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    let clock = 0;
    const results = await runStages(COMMANDS, shell, {
      cwd: '/tmp',
      parallel: true,
      availableParallelism: 4,
      nowMs: () => (clock += 5),
      nowIso: () => '2026-01-01T00:00:00.000Z',
    });

    // format finished before build started
    expect(events.indexOf('end:fmtbin')).toBeLessThan(events.indexOf('start:buildbin'));
    // build and the shell command overlapped: both started before either ended
    const bothStarted = Math.max(
      events.indexOf('start:buildbin'),
      events.indexOf('start:shellbin'),
    );
    const firstEnded = Math.min(events.indexOf('end:buildbin'), events.indexOf('end:shellbin'));
    expect(bothStarted).toBeLessThan(firstEnded);
    // test started only after both stage-2 commands ended
    expect(events.indexOf('start:testbin')).toBeGreaterThan(events.indexOf('end:buildbin'));
    expect(events.indexOf('start:testbin')).toBeGreaterThan(events.indexOf('end:shellbin'));

    // a red format did not prevent the test from running; passed is false overall
    expect(results.find((r) => r.logical_command === 'format')?.passed).toBe(false);
    expect(results.find((r) => r.logical_command === 'test')).toBeDefined();
    expect(results.every((r) => r.duration_ms > 0)).toBe(true);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('parallel=false runs every command serially in array order', async () => {
    const order: string[] = [];
    const shell: DeliveryShell = {
      async run(bin) {
        order.push(bin);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    let clock = 0;
    const results = await runStages(COMMANDS, shell, {
      cwd: '/tmp',
      parallel: false,
      availableParallelism: 4,
      nowMs: () => (clock += 5),
      nowIso: () => '2026-01-01T00:00:00.000Z',
    });
    expect(order).toEqual(['fmtbin', 'buildbin', 'shellbin', 'testbin']);
    expect(results).toHaveLength(4);
  });

  it('reports an unsupported-syntax command red without spawning it', async () => {
    const shell: DeliveryShell = {
      async run() {
        throw new Error('should not spawn');
      },
    };
    const results = await runStages(
      [{ logical_command: 'test', command: 'pnpm test | tee', stage: 3 }],
      shell,
      {
        cwd: '/tmp',
        parallel: false,
        availableParallelism: 4,
        nowMs: () => 1,
        nowIso: () => '2026-01-01T00:00:00.000Z',
      },
    );
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.invalid).toContain('Unsupported shell syntax');
  });

  it('reports an unsupported-syntax command red in parallel mode too', async () => {
    const shell: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const results = await runStages(
      [{ logical_command: 'build', command: 'pnpm build | tee', stage: 2 }],
      shell,
      { cwd: '/tmp', parallel: true, availableParallelism: 4, nowMs: () => 1, nowIso: () => 'x' },
    );
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.invalid).toContain('Unsupported shell syntax');
  });

  it('uses real default clocks when none are injected', async () => {
    const shell: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const results = await runStages(
      [{ logical_command: 'format', command: 'fmt', stage: 1 }],
      shell,
      { cwd: '/tmp', parallel: true, availableParallelism: 2 },
    );
    expect(results[0]!.started_at).not.toBe('');
    expect(results[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
