import { describe, expect, it, vi } from 'vitest';

import {
  resolveMaxRounds,
  runBuildCheckFixLoop,
  type RoundCheck,
} from '@/loop/build-check-fix-loop.js';
import {
  DEFAULT_MAX_ROUNDS_BY_LANE,
  type BuildCheckFixRound,
} from '@/core/types/build-check-fix.js';

function passing(): RoundCheck {
  return {
    done_input: {
      gates_passed: true,
      acceptance_criteria: [{ criterion_id: 'AC-1', proof_passing: true }],
      findings: [],
    },
    blocking_gates: [],
    evidence_excerpt: null,
  };
}

function failing(criterionId: string): RoundCheck {
  return {
    done_input: {
      gates_passed: false,
      acceptance_criteria: [{ criterion_id: criterionId, proof_passing: false }],
      findings: [],
    },
    blocking_gates: ['code-tests-lint'],
    evidence_excerpt: 'Verification blocked (code-tests-lint)',
  };
}

function clock(): () => string {
  let tick = 0;
  return () => `t${tick++}`;
}

describe('resolveMaxRounds', () => {
  it('uses the lane default when no override is given', () => {
    expect(resolveMaxRounds('fast')).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.fast);
    expect(resolveMaxRounds('graduated')).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.graduated);
    expect(resolveMaxRounds('full')).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.full);
  });

  it('honours a valid project override and ignores invalid ones', () => {
    expect(resolveMaxRounds('full', 8)).toBe(8);
    expect(resolveMaxRounds('full', 2.7)).toBe(2);
    expect(resolveMaxRounds('full', 0)).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.full);
    expect(resolveMaxRounds('full', null)).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.full);
  });
});

describe('runBuildCheckFixLoop', () => {
  it('terminates on isDone() when the work converges', async () => {
    let round = 0;
    const remediate = vi.fn(async () => {});
    const outcome = await runBuildCheckFixLoop({
      lane: 'full',
      now: clock(),
      remediate,
      runRound: async () => {
        round += 1;
        return round >= 2 ? passing() : failing('AC-1');
      },
    });

    expect(outcome.status).toBe('done');
    expect(outcome.rounds_used).toBe(2);
    expect(outcome.stuck_report).toBeNull();
    expect(remediate).toHaveBeenCalledTimes(1);
    expect(outcome.rounds.at(-1)?.done).toBe(true);
  });

  it('trivial work passing round 1 sees no loop machinery', async () => {
    const remediate = vi.fn(async () => {});
    const outcome = await runBuildCheckFixLoop({
      lane: 'fast',
      now: clock(),
      remediate,
      runRound: async () => passing(),
    });

    expect(outcome.status).toBe('done');
    expect(outcome.rounds_used).toBe(1);
    expect(remediate).not.toHaveBeenCalled();
    expect(outcome.stuck_report).toBeNull();
  });

  it('stops at the lane-scaled cap when it never converges but keeps making progress', async () => {
    let round = 0;
    const outcome = await runBuildCheckFixLoop({
      lane: 'full',
      now: clock(),
      // Each round fails on a DIFFERENT criterion so futility does not trip.
      runRound: async () => {
        round += 1;
        return failing(`AC-${round}`);
      },
    });

    expect(outcome.status).toBe('stopped-at-cap');
    expect(outcome.rounds_used).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.full);
    expect(outcome.max_rounds).toBe(DEFAULT_MAX_ROUNDS_BY_LANE.full);
    expect(outcome.stuck_report?.reason).toBe('stopped-at-cap');
  });

  it('respects a project round-cap override', async () => {
    let round = 0;
    const outcome = await runBuildCheckFixLoop({
      lane: 'full',
      max_rounds: 3,
      now: clock(),
      runRound: async () => {
        round += 1;
        return failing(`AC-${round}`);
      },
    });

    expect(outcome.status).toBe('stopped-at-cap');
    expect(outcome.rounds_used).toBe(3);
  });

  it('stops early via futility when there is no net progress across K rounds', async () => {
    const outcome = await runBuildCheckFixLoop({
      lane: 'full',
      now: clock(),
      futility_threshold: 2,
      // Same failing set every round → no net progress.
      runRound: async () => failing('AC-1'),
    });

    expect(outcome.status).toBe('stopped-futility');
    expect(outcome.rounds_used).toBe(2);
    expect(outcome.rounds_used).toBeLessThan(DEFAULT_MAX_ROUNDS_BY_LANE.full);
    expect(outcome.stuck_report?.reason).toBe('stopped-futility');
  });

  it('produces exactly one honest stuck report naming the blocker', async () => {
    let round = 0;
    const outcome = await runBuildCheckFixLoop({
      lane: 'graduated',
      now: clock(),
      runRound: async () => {
        round += 1;
        return failing(`AC-${round}`);
      },
    });

    expect(outcome.stuck_report).not.toBeNull();
    const report = outcome.stuck_report!;
    expect(report.blocking_gates).toContain('code-tests-lint');
    expect(report.blocking_criteria).toEqual([`AC-${outcome.rounds_used}`]);
    expect(report.evidence_excerpt).toContain('code-tests-lint');
    expect(report.decisions_needed.length).toBeGreaterThan(0);
    expect(report.decisions_needed.length).toBeLessThanOrEqual(2);
  });

  it('is quiet — emits no per-round user output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    let round = 0;
    await runBuildCheckFixLoop({
      lane: 'full',
      now: clock(),
      runRound: async () => {
        round += 1;
        return round >= 2 ? passing() : failing('AC-1');
      },
    });

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('records the round-by-round history internally', async () => {
    let round = 0;
    const outcome = await runBuildCheckFixLoop({
      lane: 'graduated',
      now: clock(),
      runRound: async () => {
        round += 1;
        return failing(`AC-${round}`);
      },
    });

    expect(outcome.rounds).toHaveLength(outcome.rounds_used);
    const numbers = outcome.rounds.map((r: BuildCheckFixRound) => r.round_number);
    expect(numbers).toEqual([1, 2, 3]);
    expect(outcome.rounds.every((r) => r.started_at !== r.completed_at)).toBe(true);
  });
});
