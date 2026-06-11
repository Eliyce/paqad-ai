import { runCiGate } from '@/delivery/ci-gate.js';
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

/** Host stub that returns a scripted sequence of check statuses. */
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
