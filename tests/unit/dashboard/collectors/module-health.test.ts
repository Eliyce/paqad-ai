import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectModuleHealth } from '@/dashboard/collectors/module-health';

const NOW = Date.UTC(2026, 4, 26);

function writeHealth(root: string, module: string, tier: string, daysOld: number): void {
  const dir = join(root, '.paqad/module-health');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${module}.json`),
    JSON.stringify({
      module,
      tier,
      updated_at: new Date(NOW - daysOld * 86_400_000).toISOString(),
    }),
  );
}

describe('collectModuleHealth', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-mh-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the directory is absent', () => {
    const { section } = collectModuleHealth(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('returns unknown when the directory is empty', () => {
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    const { section } = collectModuleHealth(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('scores green for an all-stable, fresh population', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'stable', 2);
    const { section, attention } = collectModuleHealth(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
    expect(attention).toEqual([]);
  });

  it('emits critical attention items for fragile modules', () => {
    writeHealth(root, 'payments', 'fragile', 1);
    writeHealth(root, 'core', 'stable', 1);
    const { section, attention } = collectModuleHealth(root, NOW);
    expect(attention.length).toBe(1);
    expect(attention[0]?.message).toMatch(/payments/);
    expect(attention[0]?.severity).toBe('critical');
    // Tier average: (100 + 25)/2 = 62.5 → 63 (rounded).
    expect(section.score).toBe(63);
    expect(section.band).toBe('amber');
  });

  it('penalises stale entries beyond the fresh window', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'stable', 60); // 30d penalty cap is 20 → score 80
    const { section } = collectModuleHealth(root, NOW);
    expect(section.score).toBe(80);
  });

  it('ignores entries with unrecognised tier values', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'wobbly' as unknown as string, 1);
    const { section } = collectModuleHealth(root, NOW);
    // 'wobbly' falls through to 'unknown' which weighs 0.
    expect(section.score).toBe(50);
  });
});
