import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INSTRUCTIONS_AREA_IDS,
  collectInstructionsAreas,
} from '@/dashboard/collectors/instructions-areas';

const NOW = Date.UTC(2026, 4, 26);

function touch(path: string, daysOld: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, t, t);
}

describe('collectInstructionsAreas', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-areas-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits one section per area, all unknown when nothing exists', () => {
    const sections = collectInstructionsAreas(root, NOW);
    expect(sections.map((s) => s.id).sort()).toEqual([...INSTRUCTIONS_AREA_IDS].sort());
    for (const section of sections) {
      expect(section.band).toBe('unknown');
    }
  });

  it('scores areas independently based on their own contents', () => {
    touch(join(root, 'docs/instructions/design-system/overview.md'), 1);
    touch(join(root, 'docs/instructions/stack/overview.md'), 1);
    touch(join(root, 'docs/instructions/stack/versions.md'), 1);
    const sections = collectInstructionsAreas(root, NOW);
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(byId['design-system']?.band).toBe('green');
    expect(byId['stack']?.band).toBe('green');
    expect(byId['registries']?.band).toBe('unknown');
    expect(byId['tools']?.band).toBe('unknown');
    expect(byId['tech-debt']?.band).toBe('unknown');
  });
});
