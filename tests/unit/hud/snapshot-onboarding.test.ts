import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHudText } from '@/cli/commands/status.js';
import { buildHudSnapshot, hudOnboarding } from '@/hud/snapshot.js';
import { updateRun } from '@/onboarding/journey/run-store.js';

import { at, clockAt, seedRun, tempRoot } from '../onboarding/journey/fixtures/journey.js';

describe('the HUD snapshot while onboarding', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-hud-onboarding-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('has no onboarding block without a journey', () => {
    expect(hudOnboarding(root, clockAt(1))).toBeNull();
    expect(buildHudSnapshot(root, 'session-a', { now: clockAt(1) }).onboarding).toBeUndefined();
  });

  it('routes to onboarding ahead of inner routes and renders it for status --hud', () => {
    seedRun(root);
    updateRun(root, (draft) => {
      draft.stages.detect = { status: 'done' };
      draft.stages.setup = { status: 'running', started_at: at(1) };
    });
    const snapshot = buildHudSnapshot(root, 'session-a', { now: clockAt(2) });
    expect(snapshot.route).toBe('onboarding');
    expect(snapshot.onboarding?.headline).toBe('Step 2 of 8 · Setting up paqad');
    const text = renderHudText(snapshot);
    expect(text).toContain('paqad · Onboarding · Step 2 of 8 · Setting up paqad');
    expect(text).toContain('✓ Read');
    expect(text).toContain('▸ Set up');
  });

  it('drops the block once the journey is done', () => {
    seedRun(root, { status: 'done' });
    expect(hudOnboarding(root, clockAt(1))).toBeNull();
  });
});
