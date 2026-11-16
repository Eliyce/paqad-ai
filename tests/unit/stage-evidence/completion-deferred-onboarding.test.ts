import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { updateRun } from '@/onboarding/journey/run-store.js';
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

  it('returns null with no journey', () => {
    rmSync(root, { recursive: true, force: true });
    expect(onboardingStopNudge(root, 'owner', clockAt(1))).toBeNull();
  });
});
