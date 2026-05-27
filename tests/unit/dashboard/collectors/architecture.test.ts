import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectArchitecture } from '@/dashboard/collectors/architecture';

const NOW = Date.UTC(2026, 4, 26);

function writeIndex(root: string, body: string, daysOld: number): void {
  const dir = join(root, '.paqad/context');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'chunk-index.json');
  writeFileSync(path, body);
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, t, t);
}

describe('collectArchitecture', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-arch-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when there is no chunk index', () => {
    expect(collectArchitecture(root, NOW).band).toBe('unknown');
  });

  it('returns red when the chunk index is effectively empty', () => {
    writeIndex(root, '{}', 1);
    const section = collectArchitecture(root, NOW);
    expect(section.score).toBe(0);
    expect(section.band).toBe('red');
  });

  it('scores green when the chunk index is non-empty and fresh', () => {
    writeIndex(
      root,
      JSON.stringify({ version: 1, entries: Array.from({ length: 10 }, () => ({ id: 'x' })) }),
      1,
    );
    const section = collectArchitecture(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
  });

  it('decays to amber as the index ages', () => {
    writeIndex(
      root,
      JSON.stringify({ version: 1, entries: Array.from({ length: 10 }, () => ({ id: 'x' })) }),
      200,
    );
    const section = collectArchitecture(root, NOW);
    // Presence 50 + freshness 0 = 50.
    expect(section.score).toBe(50);
    expect(section.band).toBe('amber');
  });
});
