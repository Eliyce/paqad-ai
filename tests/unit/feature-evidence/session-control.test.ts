import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureSessionControlPath } from '@/feature-evidence/paths.js';
import {
  emptyControl,
  markDone,
  pauseActive,
  readSessionControl,
  resumeFeature,
  setActiveFeature,
  setLane,
  writeSessionControl,
} from '@/feature-evidence/session-control.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-feature-session-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

const A = '339-a-01JABCDEFGHJKMNPQRSTVWXYZ0';
const B = '340-b-01JABCDEFGHJKMNPQRSTVWXYZ1';
const C = '341-c-01JABCDEFGHJKMNPQRSTVWXYZ2';

describe('readSessionControl', () => {
  it('returns a fresh empty control when the file is absent', () => {
    const root = tempRoot();
    const control = readSessionControl(root, 'ses_1');
    expect(control).toMatchObject({ session_id: 'ses_1', active: null, paused: [], lane: null });
  });

  it('returns a fresh control when the file is corrupt', () => {
    const root = tempRoot();
    const abs = join(root, featureSessionControlPath('ses_x'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'not json', 'utf8');
    expect(readSessionControl(root, 'ses_x').active).toBeNull();
  });

  it('returns a fresh control when the JSON is not a control shape', () => {
    const root = tempRoot();
    const abs = join(root, featureSessionControlPath('ses_y'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify({ hello: 'world' }), 'utf8');
    expect(readSessionControl(root, 'ses_y').active).toBeNull();
  });

  it('returns a fresh control when the JSON is a non-object primitive', () => {
    const root = tempRoot();
    for (const [ses, body] of [
      ['ses_num', '123'],
      ['ses_null', 'null'],
    ] as const) {
      const abs = join(root, featureSessionControlPath(ses));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      expect(readSessionControl(root, ses).active).toBeNull();
    }
  });

  it('reads back a written control', () => {
    const root = tempRoot();
    writeSessionControl(root, { ...emptyControl('ses_2'), active: A });
    expect(readSessionControl(root, 'ses_2').active).toBe(A);
  });

  it('emptyControl stamps a real clock by default', () => {
    expect(Date.parse(emptyControl('ses_z').updated_at)).not.toBeNaN();
  });
});

describe('setActiveFeature', () => {
  it('sets the first active with no paused', () => {
    const root = tempRoot();
    const control = setActiveFeature(root, 'ses_1', A, { lane: 'full' });
    expect(control.active).toBe(A);
    expect(control.paused).toEqual([]);
    expect(control.lane).toBe('full');
  });

  it('pushes the prior active onto the paused stack', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    const control = setActiveFeature(root, 'ses_1', B);
    expect(control.active).toBe(B);
    expect(control.paused).toEqual([A]);
  });

  it('lifts a paused feature back out when re-activated', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    setActiveFeature(root, 'ses_1', B); // paused: [A]
    const control = setActiveFeature(root, 'ses_1', A); // A active again, B paused
    expect(control.active).toBe(A);
    expect(control.paused).toEqual([B]);
  });

  it('setting the already-active feature keeps the lane when omitted', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A, { lane: 'graduated' });
    const control = setActiveFeature(root, 'ses_1', A);
    expect(control.active).toBe(A);
    expect(control.paused).toEqual([]);
    expect(control.lane).toBe('graduated');
  });
});

describe('resumeFeature', () => {
  it('pops a paused feature and pushes the current active', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    setActiveFeature(root, 'ses_1', B); // paused: [A], active B
    const control = resumeFeature(root, 'ses_1', A);
    expect(control?.active).toBe(A);
    expect(control?.paused).toEqual([B]);
  });

  it('is a no-op when the feature is already active', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    const control = resumeFeature(root, 'ses_1', A);
    expect(control?.active).toBe(A);
    expect(control?.paused).toEqual([]);
  });

  it('resumes with no current active', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    pauseActive(root, 'ses_1'); // active null, paused [A]
    const control = resumeFeature(root, 'ses_1', A);
    expect(control?.active).toBe(A);
    expect(control?.paused).toEqual([]);
  });

  it('returns null for an unknown feature', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    expect(resumeFeature(root, 'ses_1', C)).toBeNull();
  });
});

describe('pauseActive / markDone / setLane', () => {
  it('pauseActive stacks the active and clears it', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    const control = pauseActive(root, 'ses_1');
    expect(control.active).toBeNull();
    expect(control.paused).toEqual([A]);
  });

  it('pauseActive is a no-op with nothing active', () => {
    const root = tempRoot();
    const control = pauseActive(root, 'ses_1');
    expect(control.active).toBeNull();
    expect(control.paused).toEqual([]);
  });

  it('markDone clears a matching active and removes it from paused', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    setActiveFeature(root, 'ses_1', B); // active B, paused [A]
    const doneA = markDone(root, 'ses_1', A);
    expect(doneA.active).toBe(B);
    expect(doneA.paused).toEqual([]);
    const doneB = markDone(root, 'ses_1', B);
    expect(doneB.active).toBeNull();
  });

  it('setLane stashes the lane without touching the stack', () => {
    const root = tempRoot();
    setActiveFeature(root, 'ses_1', A);
    const control = setLane(root, 'ses_1', 'fast');
    expect(control.lane).toBe('fast');
    expect(control.active).toBe(A);
  });
});
