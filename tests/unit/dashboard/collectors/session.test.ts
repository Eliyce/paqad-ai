import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectSession } from '@/dashboard/collectors/session';

const NOW = Date.UTC(2026, 4, 26);

function writeHandoff(root: string, file: string, daysOld: number): void {
  const dir = join(root, '.paqad/session');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, '');
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, t, t);
}

describe('collectSession', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-sess-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when no session artifacts exist', () => {
    expect(collectSession(root, NOW).band).toBe('unknown');
  });

  it('says no handoff yet when the session dir exists but is empty', () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    const section = collectSession(root, NOW);
    expect(section.band).toBe('unknown');
    expect(section.summary).toMatch(/No handoff/);
  });

  it('scores green for a recent handoff', () => {
    writeHandoff(root, 'handoff.md', 1);
    const section = collectSession(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
  });

  it('decays as the handoff ages past 7 days', () => {
    writeHandoff(root, 'handoff.md', 60); // hits stale cliff
    const section = collectSession(root, NOW);
    expect(section.score).toBe(0);
    expect(section.band).toBe('red');
  });

  it('reports both formats as present when both files exist', () => {
    writeHandoff(root, 'handoff.md', 1);
    writeHandoff(root, 'handoff.json', 1);
    const section = collectSession(root, NOW);
    expect(section.summary).toMatch(/md \+ json/);
  });
});
