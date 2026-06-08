import { describe, expect, it } from 'vitest';

import {
  evaluateBarrelDrift,
  findOrphans,
  parseSurfaceDoc,
  PUBLIC_BARRELS,
  SURFACE_DOC_PATH,
  // @ts-expect-error -- pure JS helper shared with the runnable check scripts
} from '../../../scripts/lib/surface-doc.mjs';

const SAMPLE = `# Surface

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| cli | src/cli/index.ts | \`runCli\` | \`runCli(): Promise<void>\` | stable | 1.0.0 | |
| api | src/x.ts | \`ghostSymbol\` | \`ghostSymbol(): void\` | internal | 1.0.0 | |
| api | src/y.ts | \`dynamicSymbol\` | \`dynamicSymbol(): void\` | beta | 1.0.0 | resolved at runtime |
`;

describe('parseSurfaceDoc', () => {
  it('extracts entries from tables that have Symbol and Stability columns', () => {
    const entries = parseSurfaceDoc(SAMPLE);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      consumer: 'cli',
      engineModule: 'src/cli/index.ts',
      symbol: 'runCli',
      stability: 'stable',
      since: '1.0.0',
      exempt: undefined,
    });
    expect(entries[2].exempt).toBe('resolved at runtime');
  });

  it('ignores tables without the required columns', () => {
    const entries = parseSurfaceDoc('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    expect(entries).toHaveLength(0);
  });
});

describe('findOrphans', () => {
  it('reports documented symbols no consumer uses and skips used and exempt ones', () => {
    const entries = parseSurfaceDoc(SAMPLE);
    const orphans = findOrphans(entries, ['runCli']);
    expect(orphans.map((o) => o.symbol)).toEqual(['ghostSymbol']);
    expect(orphans[0].recommendation).toContain('Remove ghostSymbol');
  });

  it('recommends downgrading a non-internal orphan and accepts a Set', () => {
    const entries = parseSurfaceDoc(SAMPLE.replace('| internal |', '| stable |'));
    const orphans = findOrphans(entries, new Set(['runCli', 'dynamicSymbol']));
    expect(orphans).toHaveLength(1);
    expect(orphans[0].recommendation).toContain('Downgrade ghostSymbol');
  });
});

describe('evaluateBarrelDrift', () => {
  it('flags a barrel change with no surface-doc amendment', () => {
    const result = evaluateBarrelDrift(['src/index.ts', 'src/foo.ts']);
    expect(result.violation).toBe(true);
    expect(result.changedBarrels).toEqual(['src/index.ts']);
    expect(result.documentAmended).toBe(false);
  });

  it('passes when the surface doc is amended alongside the barrel', () => {
    const result = evaluateBarrelDrift(['./src/cli/index.ts', SURFACE_DOC_PATH]);
    expect(result.violation).toBe(false);
    expect(result.changedBarrels).toEqual(['src/cli/index.ts']);
    expect(result.documentAmended).toBe(true);
  });

  it('passes when no public barrel changed', () => {
    const result = evaluateBarrelDrift(['src/foo.ts', 'README.md']);
    expect(result.violation).toBe(false);
    expect(result.changedBarrels).toEqual([]);
  });

  it('exposes the tracked barrels', () => {
    expect(PUBLIC_BARRELS).toContain('src/rule-scripts/index.ts');
  });
});
