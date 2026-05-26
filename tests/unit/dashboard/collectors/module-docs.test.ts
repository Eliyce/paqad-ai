import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { collectModuleDocs } from '@/dashboard/collectors/module-docs';

const NOW = Date.UTC(2026, 4, 26);

function writeModuleMap(root: string, slugs: string[]): void {
  mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  writeFileSync(
    join(root, 'docs/instructions/rules/module-map.yml'),
    YAML.stringify({ modules: slugs.map((slug) => ({ slug, name: slug })) }),
  );
}

function writeSummary(root: string, slug: string, daysOld: number): void {
  const dir = join(root, 'docs/modules', slug, 'index');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'summary.md');
  writeFileSync(file, `# ${slug}\n`);
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(file, t, t);
}

describe('collectModuleDocs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-md-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when there is no module map', () => {
    expect(collectModuleDocs(root, NOW).band).toBe('unknown');
  });

  it('scores green with all modules documented and fresh', () => {
    writeModuleMap(root, ['a', 'b']);
    writeSummary(root, 'a', 1);
    writeSummary(root, 'b', 2);
    const section = collectModuleDocs(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
  });

  it('penalises missing module docs', () => {
    writeModuleMap(root, ['a', 'b', 'c', 'd', 'e']);
    writeSummary(root, 'a', 1);
    writeSummary(root, 'b', 1);
    const section = collectModuleDocs(root, NOW);
    // 2/5 presence (24) + 2/2 fresh (40) = 64.
    expect(section.score).toBe(64);
    expect((section.details?.missing as string[]).length).toBe(3);
  });

  it('penalises stale module docs', () => {
    writeModuleMap(root, ['a', 'b']);
    writeSummary(root, 'a', 1);
    writeSummary(root, 'b', 200); // stale
    const section = collectModuleDocs(root, NOW);
    // 2/2 presence (60) + 1/2 fresh (20) = 80.
    expect(section.score).toBe(80);
    expect(section.metrics.find((m) => m.label === 'stale')?.value).toBe('1');
  });
});
