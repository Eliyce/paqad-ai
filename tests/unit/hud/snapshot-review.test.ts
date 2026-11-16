import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStatusCommand, renderHudText } from '@/cli/commands/status.js';
import { buildHudSnapshot, hudReview } from '@/hud/snapshot.js';
import { updateRun } from '@/onboarding/journey/run-store.js';
import {
  abandonReview,
  finishReview,
  findingReview,
  gapReview,
  stageReview,
  startReview,
} from '@/review-runs/actions.js';

import { seedRun } from '../onboarding/journey/fixtures/journey.js';
import { DESIGN, SECURITY, at, clockAt, tempRoot } from '../review-runs/fixtures.js';

function clockAtMs(ms: number): () => Date {
  return () => new Date(Date.parse(at(0)) + ms);
}

describe('the HUD snapshot while a review is open', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-hud-review-');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('EC-1: carries no review and prints no review line without a run', () => {
    expect(hudReview(root, clockAt(1))).toBeNull();
    const snapshot = buildHudSnapshot(root, 'session-a', { now: clockAt(1) });
    expect(snapshot.review).toBeUndefined();
    expect(renderHudText(snapshot)).not.toContain('review:');
  });

  it('AC-17: a finished review is carried at 29:59 and gone at 30:00 and 30:01', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    finishReview(root, SECURITY, { now: clockAt(0) });
    expect(hudReview(root, clockAtMs(29 * 60_000 + 59_000))?.word).toBe('Security review');
    expect(hudReview(root, clockAtMs(30 * 60_000))).toBeNull();
    expect(hudReview(root, clockAtMs(30 * 60_000 + 1000))).toBeNull();
  });

  it('AC-18: onboarding wins over an open review, and the later review wins over the other', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    startReview(root, DESIGN, { now: clockAt(1) });
    expect(hudReview(root, clockAt(2))?.kind).toBe('design');
    stageReview(root, SECURITY, 'scope', 'start', { now: clockAt(2) });
    expect(hudReview(root, clockAt(3))?.kind).toBe('security');
    seedRun(root);
    updateRun(root, (draft) => {
      draft.stages.detect = { status: 'running', started_at: at(1) };
    });
    const snapshot = buildHudSnapshot(root, 'session-a', { now: clockAt(3) });
    expect(snapshot.route).toBe('onboarding');
    expect(snapshot.onboarding).toBeTruthy();
    expect(snapshot.review).toBeUndefined();
  });

  it('AC-19: status --hud prints Security review: <headline> for each run state', () => {
    const text = (minute: number) =>
      renderHudText(buildHudSnapshot(root, 'session-a', { now: clockAt(minute) }));
    startReview(root, SECURITY, { now: clockAt(0) });
    expect(text(0)).toContain('Security review: Security review has not started');
    stageReview(root, SECURITY, 'scope', 'start', { now: clockAt(1) });
    expect(text(1)).toContain('Security review: Stage 1 of 8 · Setting the scope');
    stageReview(root, SECURITY, 'scope', 'done', { now: clockAt(2) });
    expect(text(2)).toContain('Security review: Next: stage 2 of 8 · Map the attack surface');
    stageReview(root, SECURITY, 'map', 'start', { now: clockAt(3) });
    expect(text(24)).toContain(
      'Security review: Stopped at stage 2 · Map the attack surface · Resume to continue',
    );
    findingReview(root, SECURITY, { severity: 'low', proof: 'lead' }, { now: clockAt(4) });
    gapReview(
      root,
      SECURITY,
      { code: 'tool', stage: 'scan', say: 'no scanner' },
      { now: clockAt(5) },
    );
    findingReview(root, SECURITY, { severity: 'high', proof: 'confirmed' }, { now: clockAt(6) });
    finishReview(root, SECURITY, { now: clockAt(7) });
    const finished = text(8);
    expect(finished).toContain('Security review: 1 serious finding confirmed');
    expect(finished).toContain('1 lead, not confirmed');
    expect(finished).toContain('gap: scan · no scanner');
  });

  it('AC-19: status --hud --json carries the same review object as the snapshot', async () => {
    startReview(root, SECURITY, { now: () => new Date() });
    abandonReview(root, SECURITY, { now: () => new Date() });
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    await createStatusCommand().parseAsync(
      ['--hud', '--format', 'json', '--project-root', root, '--session', 'session-a'],
      { from: 'user' },
    );
    vi.restoreAllMocks();
    const printed = JSON.parse(out.join('')).review;
    expect(printed.headline.text).toBe('Stopped at stage 1 · Set the scope · Resume to continue');
    const direct = hudReview(root, () => new Date());
    expect(printed).toEqual(direct);
  });
});
