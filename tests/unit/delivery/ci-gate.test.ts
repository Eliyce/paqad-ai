import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CI_REFRESH_INTERVAL_MS,
  countChecks,
  pollBudget,
  runCiGate,
  waitFor,
} from '@/delivery/ci-gate.js';
import type { ResolvedDeliveryCi } from '@/core/types/delivery-policy.js';
import type { ChecksStatus, HostProvider } from '@/providers/host-provider.js';

function ci(overrides: Partial<ResolvedDeliveryCi> = {}): ResolvedDeliveryCi {
  return {
    maintained: 'auto',
    gate: 'wait_for_green',
    timeout_minutes: 30,
    on_red: 'stop',
    transition_on_green: 'Done',
    ...overrides,
  };
}

function hostWith(sequence: ChecksStatus[]): HostProvider {
  let i = 0;
  return {
    kind: 'github',
    ensureBranch: async () => ({ ok: true }),
    commit: async () => ({ ok: true }),
    push: async () => ({ ok: true }),
    openPR: async () => ({ ok: true }),
    comment: async () => ({ ok: true }),
    getChecksStatus: async () => sequence[Math.min(i++, sequence.length - 1)],
  };
}

describe('CI gate', () => {
  it('skips when gate is off', async () => {
    const res = await runCiGate(
      hostWith([{ state: 'green', checks: [] }]),
      'b',
      ci({ gate: 'off' }),
    );
    expect(res.action).toBe('skipped');
  });

  it('warn_only never blocks and reports the state', async () => {
    const res = await runCiGate(
      hostWith([{ state: 'red', checks: [{ name: 'test', state: 'red' }] }]),
      'b',
      ci({ gate: 'warn_only' }),
    );
    expect(res.action).toBe('warned');
    expect(res.state).toBe('red');
    expect(res.transitionTo).toBe(null);
  });

  it('passes on green and carries the transition_on_green', async () => {
    const res = await runCiGate(hostWith([{ state: 'green', checks: [] }]), 'b', ci());
    expect(res.action).toBe('passed');
    expect(res.transitionTo).toBe('Done');
  });

  it('polls through pending until green (injected clock, no real waiting)', async () => {
    const host = hostWith([
      { state: 'pending', checks: [] },
      { state: 'pending', checks: [] },
      { state: 'green', checks: [] },
    ]);
    let clock = 0;
    const res = await runCiGate(host, 'b', ci(), {
      now: () => clock,
      sleep: async () => {
        clock += 1000;
      },
    });
    expect(res.action).toBe('passed');
  });

  it('stops on red with on_red=stop', async () => {
    const res = await runCiGate(
      hostWith([{ state: 'red', checks: [{ name: 'lint', state: 'red' }] }]),
      'b',
      ci({ on_red: 'stop' }),
    );
    expect(res.action).toBe('failed_stop');
    expect(res.message).toContain('lint');
  });

  it('uses comment_and_stop action when configured', async () => {
    const res = await runCiGate(
      hostWith([{ state: 'red', checks: [] }]),
      'b',
      ci({ on_red: 'comment_and_stop' }),
    );
    expect(res.action).toBe('failed_comment_and_stop');
  });

  it('posts the evidence comment on green', async () => {
    const posted: Array<[string, string]> = [];
    const host = hostWith([{ state: 'green', checks: [] }]);
    host.comment = async (ref, body) => {
      posted.push([ref, body]);
      return { ok: true };
    };
    const res = await runCiGate(host, 'feat/x', ci(), { evidenceComment: '## paqad evidence' });
    expect(res.action).toBe('passed');
    expect(res.evidenceCommentPosted).toBe(true);
    expect(posted).toEqual([['feat/x', '## paqad evidence']]);
  });

  it('does not post when no evidence body is supplied', async () => {
    let called = false;
    const host = hostWith([{ state: 'green', checks: [] }]);
    host.comment = async () => {
      called = true;
      return { ok: true };
    };
    const res = await runCiGate(host, 'b', ci());
    expect(res.evidenceCommentPosted).toBe(false);
    expect(called).toBe(false);
  });

  it('posts the evidence on a comment_and_stop red but not a plain-stop red', async () => {
    const commentAndStop = hostWith([{ state: 'red', checks: [{ name: 'x', state: 'red' }] }]);
    let cs = false;
    commentAndStop.comment = async () => {
      cs = true;
      return { ok: true };
    };
    const r1 = await runCiGate(commentAndStop, 'b', ci({ on_red: 'comment_and_stop' }), {
      evidenceComment: 'body',
    });
    expect(r1.action).toBe('failed_comment_and_stop');
    expect(r1.evidenceCommentPosted).toBe(true);
    expect(cs).toBe(true);

    const plainStop = hostWith([{ state: 'red', checks: [{ name: 'x', state: 'red' }] }]);
    let ps = false;
    plainStop.comment = async () => {
      ps = true;
      return { ok: true };
    };
    const r2 = await runCiGate(plainStop, 'b', ci({ on_red: 'stop' }), { evidenceComment: 'body' });
    expect(r2.action).toBe('failed_stop');
    expect(r2.evidenceCommentPosted).toBe(false);
    expect(ps).toBe(false);
  });

  it('best-effort: a comment failure never changes the green verdict', async () => {
    const host = hostWith([{ state: 'green', checks: [] }]);
    host.comment = async () => {
      throw new Error('gh exploded');
    };
    const res = await runCiGate(host, 'b', ci(), { evidenceComment: 'body' });
    expect(res.action).toBe('passed');
    expect(res.evidenceCommentPosted).toBe(false);
  });

  it('times out when checks never go green', async () => {
    const host = hostWith([{ state: 'pending', checks: [] }]);
    let clock = 0;
    const res = await runCiGate(host, 'b', ci({ timeout_minutes: 1 }), {
      now: () => clock,
      sleep: async () => {
        clock += 60_000;
      },
    });
    expect(res.action).toBe('timed_out');
  });
});

describe('CI gate check counts', () => {
  it('keeps how many checks finished out of how many there are', async () => {
    const status: ChecksStatus = {
      state: 'red',
      checks: [
        { name: 'lint', state: 'red' },
        { name: 'test', state: 'green' },
        { name: 'e2e', state: 'pending' },
      ],
    };
    expect(countChecks(status)).toEqual({ done: 2, total: 3 });
    const res = await runCiGate(hostWith([status]), 'b', ci());
    expect(res.checks).toEqual({ done: 2, total: 3 });
    const warned = await runCiGate(hostWith([status]), 'b', ci({ gate: 'warn_only' }));
    expect(warned.checks).toEqual({ done: 2, total: 3 });
    const skipped = await runCiGate(hostWith([status]), 'b', ci({ gate: 'off' }));
    expect(skipped.checks).toBeUndefined();
  });
});

describe('CI polling while checks run', () => {
  const running: ChecksStatus = {
    state: 'pending',
    checks: [
      { name: 'build', state: 'green' },
      { name: 'test', state: 'pending' },
    ],
  };
  const finished: ChecksStatus = {
    state: 'green',
    checks: [
      { name: 'build', state: 'green' },
      { name: 'test', state: 'green' },
    ],
  };

  function countingHost(sequence: ChecksStatus[]): { host: HostProvider; calls: () => number } {
    let reads = 0;
    const host = hostWith(sequence);
    const read = host.getChecksStatus.bind(host);
    host.getChecksStatus = async (ref) => {
      reads += 1;
      return read(ref);
    };
    return { host, calls: () => reads };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-14: reads the checks once a minute and stops as soon as they are done', async () => {
    const { host, calls } = countingHost([running, running, finished]);
    let clock = 0;
    const waits: number[] = [];
    const readAt: number[] = [];
    const res = await runCiGate(host, 'b', ci(), {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      onPoll: () => readAt.push(clock),
    });
    expect(CI_REFRESH_INTERVAL_MS).toBe(60_000);
    expect(res.action).toBe('passed');
    expect(waits).toEqual([60_000, 60_000]);
    expect(readAt).toEqual([0, 60_000, 120_000]);
    expect(calls()).toBe(3);
  });

  it('times out once the policy timeout passes and reads gh a bounded number of times', async () => {
    const { host, calls } = countingHost([running]);
    let clock = 0;
    const res = await runCiGate(host, 'b', ci({ timeout_minutes: 5 }), {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(res.action).toBe('timed_out');
    expect(res.message).toContain('5 minute(s)');
    expect(res.checks).toEqual({ done: 1, total: 2 });
    expect(clock).toBe(5 * 60_000);
    expect(calls()).toBe(6);
  });

  it('a clock that never moves still stops after the poll budget', async () => {
    const { host, calls } = countingHost([running]);
    let sleeps = 0;
    const res = await runCiGate(host, 'b', ci({ timeout_minutes: 3 }), {
      now: () => 0,
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(res.action).toBe('timed_out');
    expect(res.state).toBe('pending');
    expect(res.checks).toEqual({ done: 1, total: 2 });
    expect(res.message).toContain('4 time(s)');
    expect(calls()).toBe(pollBudget(3, CI_REFRESH_INTERVAL_MS));
    expect(calls()).toBe(4);
    expect(sleeps).toBe(3);
  });

  it('an explicit poll cap of zero still reads the checks once', async () => {
    const { host, calls } = countingHost([running]);
    const res = await runCiGate(host, 'b', ci(), { maxPolls: 0, now: () => 0 });
    expect(res.action).toBe('timed_out');
    expect(calls()).toBe(1);
  });

  it('waits on the real clock by default, about a minute between reads', async () => {
    vi.useFakeTimers({ now: 0 });
    const { host, calls } = countingHost([running, finished]);
    const pending = runCiGate(host, 'b', ci());
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.action).toBe('passed');
    expect(calls()).toBe(2);
  });

  it('waitFor resolves after the given time', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = waitFor(1_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });

  it('runCiGate hands every poll to onPoll', async () => {
    const polls: ChecksStatus[] = [];
    await runCiGate(hostWith([running, finished]), 'b', ci(), {
      now: () => 0,
      sleep: async () => {},
      onPoll: (s) => polls.push(s),
    });
    expect(polls).toEqual([running, finished]);
  });
});
