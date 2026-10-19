import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  featureStagePath,
  openFeatureChange,
  recordedLaneOrFull,
} from '@/feature-evidence/stage-ledger.js';

// Issue #639, Part 11 — the one recorded-lane reader the completion verification and
// `checks run` share. It fails safe to `full`, never to a lighter lane.
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recorded-lane-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

describe('recordedLaneOrFull', () => {
  it('reads the lane recorded on the change', () => {
    const root = project();
    const dir = openFeatureChange(root, 's', {
      adapter: 'claude-code',
      title: 'ORD-482 fix',
      issue: 'ORD-482',
      lane: 'graduated',
    });
    expect(recordedLaneOrFull(root, 's', dir)).toBe('graduated');
  });

  it('fails safe to full with no change, no lane, or an unreadable change', () => {
    const root = project();
    expect(recordedLaneOrFull(root, 's', null)).toBe('full');
    const unset = openFeatureChange(root, 's', {
      adapter: 'claude-code',
      title: 'no lane',
      issue: null,
    });
    expect(recordedLaneOrFull(root, 's', unset)).toBe('full');
    // A directory where the stage file should be makes the fold throw.
    rmSync(join(root, featureStagePath(unset)), { force: true });
    mkdirSync(join(root, featureStagePath(unset)), { recursive: true });
    expect(recordedLaneOrFull(root, 's', unset)).toBe('full');
  });
});
