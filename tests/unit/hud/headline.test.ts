import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildTrackRecords,
  computeHudFlags,
  computeHudHeadline,
  type HudHeadlineInput,
  type HudStage,
} from '@/hud/snapshot.js';

function stage(name: string, state: HudStage['state'], mandatory = true): HudStage {
  return {
    stage: name,
    state,
    mandatory,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    duration_unreliable: false,
    agent: null,
    proof_file: null,
  } as HudStage;
}

function headline(input: Partial<HudHeadlineInput>): ReturnType<typeof computeHudHeadline> {
  return computeHudHeadline({
    route: null,
    active: true,
    stages: [],
    pendingDecisions: 0,
    verdict: null,
    flags: [],
    paused: 0,
    ...input,
  });
}

describe('computeHudHeadline', () => {
  it('counts several waiting decisions in the plural', () => {
    expect(headline({ pendingDecisions: 2 })).toEqual({
      text: 'Needs you: 2 decisions waiting.',
      tone: 'needs-you',
    });
  });

  it('names an unknown running stage as written and leaves out a missing next stage', () => {
    expect(headline({ stages: [stage('custom-step', 'running')] })).toEqual({
      text: 'custom-step in progress.',
      tone: 'working',
    });
  });

  it('marks an inconclusive verdict as a warning with plural flags', () => {
    expect(
      headline({
        verdict: { kind: 'inconclusive', word: 'Inconclusive' } as never,
        flags: [
          { id: 'a', text: 'a' },
          { id: 'b', text: 'b' },
        ],
      }),
    ).toEqual({ text: 'Inconclusive. 2 flags open.', tone: 'warn' });
    expect(headline({ verdict: { kind: 'pass', word: 'Safe to merge' } as never })).toEqual({
      text: 'Safe to merge.',
      tone: 'good',
    });
  });

  it('names the next stage without a finished one, and waits once every stage is recorded', () => {
    expect(headline({ stages: [stage('planning', 'missing')] })).toEqual({
      text: 'Next: Planning.',
      tone: 'working',
    });
    expect(headline({ stages: [stage('planning', 'complete')] })).toEqual({
      text: 'Every stage is recorded. Waiting for the verdict.',
      tone: 'working',
    });
  });

  it('reports an idle session as ready, and a routed one as working', () => {
    expect(headline({ active: false })).toEqual({
      text: 'Ready. No change in progress.',
      tone: 'neutral',
    });
    expect(headline({ active: false, route: 'no-workflow' }).text).toBe(
      'Ready. No change in progress.',
    );
  });
});

describe('computeHudFlags', () => {
  it('counts one rule finding and several near copies', () => {
    const flags = computeHudFlags({
      stages: [stage('development', 'missing')],
      gates: [],
      rulesRecorded: false,
      tableSkipped: false,
      isolationStatus: 'not-required',
      isolatedStages: 0,
      findings: {
        rules: { total: 1 },
        near_copies: { total: 3 },
      } as never,
    });
    expect(flags.map((flag) => flag.text)).toEqual([
      '1 rule finding is open.',
      '3 near-copies of existing code are open.',
    ]);
  });
});

describe('buildTrackRecords', () => {
  it('returns nothing for no roles or no other changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-track-'));
    try {
      expect(buildTrackRecords(root, 'x', []).size).toBe(0);
      expect(buildTrackRecords(root, 'x', ['qa-engineer']).size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
