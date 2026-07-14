import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { findLatestSidecar, readHealthSidecar } from '@/codebase-health/store.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-store-'));
}

describe('readHealthSidecar', () => {
  it('returns null for missing, corrupt, or wrong-shape files', () => {
    const root = repo();
    expect(readHealthSidecar(join(root, 'nope.json'))).toBeNull();
    const bad = join(root, 'bad.json');
    writeFileSync(bad, 'not json');
    expect(readHealthSidecar(bad)).toBeNull();
    const wrong = join(root, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ findings: 'no' }));
    expect(readHealthSidecar(wrong)).toBeNull();
  });

  it('reads a valid sidecar', () => {
    const root = repo();
    const good = join(root, 'good.json');
    writeFileSync(good, JSON.stringify({ findings: [], report_id: 'HEALTH-x' }));
    expect(readHealthSidecar(good)?.report_id).toBe('HEALTH-x');
  });
});

describe('findLatestSidecar', () => {
  it('returns null when the health dir is absent', () => {
    expect(findLatestSidecar(repo())).toBeNull();
  });

  it('picks the newest non-retest sidecar', () => {
    const root = repo();
    const dir = join(root, PATHS.HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-01-01-00-00-00.json'), '{}');
    writeFileSync(join(dir, '2026-02-01-00-00-00.json'), '{}');
    writeFileSync(join(dir, '2026-02-01-00-00-00-retest-2026-03-01-00-00-00.json'), '{}');
    writeFileSync(join(dir, '2026-01-01-00-00-00.md'), '');
    expect(findLatestSidecar(root)).toContain('2026-02-01-00-00-00.json');
  });

  it('returns null when only retest sidecars exist', () => {
    const root = repo();
    const dir = join(root, PATHS.HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a-retest-b.json'), '{}');
    expect(findLatestSidecar(root)).toBeNull();
  });
});
