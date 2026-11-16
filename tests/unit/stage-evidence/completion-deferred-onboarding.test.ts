import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, readEvents } from '@/onboarding/journey/events.js';
import { updateRun } from '@/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '@/onboarding/journey/stages.js';
import { onboardingStopNudge } from '@/stage-evidence/completion-deferred.js';

import { clockAt, seedRun, tempRoot } from '../onboarding/journey/fixtures/journey.js';

describe('the onboarding Stop nudge', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-stop-');
    seedRun(root, { owner_session: 'owner' });
    updateRun(root, (draft) => {
      draft.stages.detect = { status: 'done' };
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('nudges the owner session once between steps', () => {
    const nudge = onboardingStopNudge(root, 'owner', clockAt(1));
    expect(nudge).toContain('Step 2 of 8');
    expect(nudge).toContain('paqad-ai onboarding next');
    expect(onboardingStopNudge(root, 'owner', clockAt(2))).toBeNull();
  });

  it('never nudges another session, a running step or a paused journey', () => {
    expect(onboardingStopNudge(root, 'someone-else', clockAt(1))).toBeNull();
    updateRun(root, (draft) => {
      draft.stages.setup = { status: 'running' };
    });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toBeNull();
    updateRun(root, (draft) => {
      draft.status = 'paused';
    });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toBeNull();
  });

  it('stamps the nudge with the real clock when no clock is given', () => {
    const before = Date.now();
    expect(onboardingStopNudge(root, 'owner')).toContain('Step 2 of 8');
    const nudge = readEvents(root, 'run-1').find((event) => event.note === 'nudge:setup');
    expect(Date.parse(nudge!.ts)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('still nudges after a heartbeat for another step or another kind of row', () => {
    appendEvent(root, {
      ts: clockAt(0)().toISOString(),
      run_id: 'run-1',
      kind: 'heartbeat',
      note: 'nudge:detect',
    });
    appendEvent(root, {
      ts: clockAt(0)().toISOString(),
      run_id: 'run-1',
      kind: 'agent_start',
      note: 'nudge:setup',
    });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toContain('Step 2 of 8');
  });

  it('never nudges a session-less Stop or a journey with every step done', () => {
    expect(onboardingStopNudge(root, null, clockAt(1))).toBeNull();
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
    });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toBeNull();
    expect(readEvents(root, 'run-1')).toEqual([]);
  });

  it('returns null with no journey', () => {
    rmSync(root, { recursive: true, force: true });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toBeNull();
  });
});
