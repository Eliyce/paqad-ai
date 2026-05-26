import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectWorkflows } from '@/dashboard/collectors/workflows';

const NOW = Date.UTC(2026, 4, 26);

function writeYaml(path: string, daysOld: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'name: x\n');
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, t, t);
}

describe('collectWorkflows', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-wf-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the directory is missing', () => {
    expect(collectWorkflows(root, NOW).band).toBe('unknown');
  });

  it('only counts yaml/yml files, not markdown', () => {
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeYaml(join(root, 'docs/instructions/workflows/feature.yaml'), 1);
    writeFileSync(join(root, 'docs/instructions/workflows/README.md'), '');
    const section = collectWorkflows(root, NOW);
    expect(section.metrics.find((m) => m.label === 'files')?.value).toBe('1');
    expect(section.band).toBe('green');
  });
});
