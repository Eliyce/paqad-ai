import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPreflight } from '../../../../src/onboarding/journey/preflight.js';

import { seedRun, tempRoot, writeFile } from './fixtures/journey.js';

const ASKED = { asked: true, fromTray: false, isTTY: false };

describe('onboarding preflight', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('FR-7: needs --asked or the tray off a TTY', () => {
    expect(runPreflight(root, { asked: false, fromTray: false, isTTY: false }).kind).toBe(
      'refused',
    );
    expect(runPreflight(root, { asked: false, fromTray: false, isTTY: true }).kind).toBe('ok');
    expect(runPreflight(root, { asked: false, fromTray: true, isTTY: false }).kind).toBe('ok');
  });

  it('lists foreign pending decision packets and leaves them untouched', () => {
    writeFile(root, '.paqad/decisions/pending/D-1.json', '{}');
    const result = runPreflight(root, ASKED);
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.foreign_packets).toEqual(['D-1.json']);
  });

  it('NFR-9: attaches to an open journey', () => {
    seedRun(root, { status: 'paused' });
    expect(runPreflight(root, ASKED).kind).toBe('attach');
  });

  it('records a sha256 baseline for every dirty path', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFile(root, 'notes.md', 'mine');
    const result = runPreflight(root, ASKED);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(Object.keys(result.baseline)).toEqual(['notes.md']);
  });
});
