import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SlicingRuleError, writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  computeWaves,
  normalizeWorkstream,
  renderSlicingViolation,
  validateSlicing,
  waveCap,
  type Workstream,
} from '@/planning/slicing.js';

import { openChange, writeSpec } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-slicing-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function ws(id: string, extra: Partial<Workstream> = {}): Partial<Workstream> {
  return {
    id,
    owned_files: [`src/${id}/**`, `tests/${id}/**`],
    acs: [],
    depends_on: [],
    provides_seams: [],
    uses_seams: [],
    ...extra,
  };
}

const noModule = () => null;

const REUSE = {
  consulted: [{ source: 'grep' as const, query: 'x', hits: 0 }],
  reusing: [],
  new_constructs: [],
};

function rules(input: Parameters<typeof validateSlicing>[0]): string[] {
  return validateSlicing(input).violations.map(renderSlicingViolation);
}

describe('slicing rules', () => {
  it('AC-1 names each broken rule with its slice or file', () => {
    const lines = rules({
      workstreams: [
        ws('a', {
          owned_files: ['src/**', 'tests/a/**'],
          acs: ['AC-1'],
          size_budget: { files: 1 },
        }),
        ws('b', { acs: ['AC-1'], uses_seams: ['store'], depends_on: ['c'] }),
        ws('c', {
          owned_files: ['src/c/**'],
          provides_seams: [{ name: 'store', entry_file: 'src/c/store.ts', wired_ac: 'AC-2' }],
          depends_on: ['b'],
        }),
        ws('d', {
          uses_seams: ['store'],
          risk: 'routine',
          owned_files: ['runtime/hooks/**', 'tests/d/**'],
        }),
        ws('e', { owned_files: ['lib/**', 'tests/e/**'] }),
      ],
      stepFiles: [
        'src/b/x.ts',
        'src/a/y.ts',
        'src/a/z.ts',
        'runtime/hooks/gate.mjs',
        'lib/one.ts',
        'lib/two.ts',
      ],
      criteria: ['AC-1', 'AC-3'],
      moduleOf: (file) =>
        file.startsWith('lib/one') ? 'core' : file.startsWith('lib/') ? 'cli' : null,
      cores: 8,
    });
    expect(lines).toEqual(
      expect.arrayContaining([
        'slicing rule one-owner: src/b/x.ts',
        'slicing rule seam-only: d',
        'slicing rule acs-in-own-tests: c',
        'slicing rule acs-in-own-tests: AC-1',
        'slicing rule acs-in-own-tests: AC-3',
        'slicing rule acyclic: b -> c -> b',
        'slicing rule size-budget: a',
        'slicing rule module-map: e',
        'slicing rule routine-on-sensitive: runtime/hooks/gate.mjs',
      ]),
    );
  });

  it('AC-1 plan compile refuses a broken plan and writes no plan.json', () => {
    const root = project();
    const dir = openChange(root, 'ses-slice');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    let thrown: unknown;
    try {
      writeFeaturePlan(root, 'ses-slice', {
        summary: 'split it',
        reuse: REUSE,
        steps: [{ id: 'S1', description: 'x', files: ['src/a/x.ts'] }],
        workstreams: [ws('a', { acs: ['AC-1'] }), ws('b', { owned_files: ['src/**'], acs: [] })],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SlicingRuleError);
    expect((thrown as SlicingRuleError).errors).toContain('slicing rule one-owner: src/a/x.ts');
    expect(existsSync(join(root, featureFilePath(dir, 'plan')))).toBe(false);
  });

  it('AC-15 stores the waves and one joining entry per area with lead files plus lint-cleanup', () => {
    const root = project();
    const dir = openChange(root, 'ses-join');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
      { id: 'AC-3', proof: 'automated' },
    ]);
    writeFeaturePlan(root, 'ses-join', {
      summary: 'three slices',
      reuse: REUSE,
      steps: [
        { id: 'S1', description: 'a', files: ['src/a/a.ts', 'src/b/b.ts', 'src/c/c.ts'] },
        {
          id: 'S2',
          description: 'lead',
          files: ['src/index.ts', 'docs/guide.md', '.paqad/configs/x.yaml'],
        },
      ],
      workstreams: [
        ws('a', { acs: ['AC-1'] }),
        ws('b', { acs: ['AC-2'], depends_on: ['a'] }),
        ws('c', { acs: ['AC-3'] }),
      ],
    });
    const plan = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'plan')), 'utf8'));
    expect(plan.waves).toEqual([['a', 'c'], ['b']]);
    expect(plan.joining.map((entry: { id: string }) => entry.id)).toEqual([
      'join-wiring',
      'join-gate-configs',
      'join-docs',
      'join-lint-cleanup',
    ]);
    expect(plan.joining[0].owned_files).toEqual(['src/index.ts']);
  });

  it('AC-25 stores an untagged workstream as high and refuses routine on hook code', () => {
    const result = validateSlicing({
      workstreams: [
        ws('plain'),
        ws('hooks', { risk: 'routine', owned_files: ['runtime/hooks/**', 'tests/hooks/**'] }),
      ],
      stepFiles: ['src/plain/a.ts', 'runtime/hooks/stop.mjs'],
      criteria: null,
      moduleOf: noModule,
      cores: 8,
    });
    expect(result.workstreams[0]!.risk).toBe('high');
    expect(result.violations.map(renderSlicingViolation)).toEqual([
      'slicing rule routine-on-sensitive: runtime/hooks/stop.mjs',
    ]);
  });

  it('AC-41 caps the wave size at 2, 2, 6 and 6 for 2, 4, 12 and 64 cores', () => {
    const ten = Array.from({ length: 10 }, (_, i) => normalizeWorkstream(ws(`w${i}`)));
    const sizes = [2, 4, 12, 64].map((cores) =>
      Math.max(...computeWaves(ten, cores).map((w) => w.length)),
    );
    expect(sizes).toEqual([2, 2, 6, 6]);
    expect(waveCap(64)).toBe(6);
  });

  it('AC-28 a plan with no workstreams stores no workstreams, waves or joining keys', () => {
    const root = project();
    const dir = openChange(root, 'ses-plain');
    writeFeaturePlan(root, 'ses-plain', {
      summary: 'plain',
      reuse: REUSE,
      steps: [{ id: 'S1', description: 'x', files: ['src/x.ts'] }],
      workstreams: [],
    });
    const plan = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'plan')), 'utf8'));
    expect(Object.keys(plan)).not.toContain('workstreams');
    expect(Object.keys(plan)).not.toContain('waves');
    expect(Object.keys(plan)).not.toContain('joining');
  });

  it('checks 500 files against 10 workstreams quickly', () => {
    const files = Array.from({ length: 500 }, (_, i) => `src/w${i % 10}/f${i}.ts`);
    const started = Date.now();
    validateSlicing({
      workstreams: Array.from({ length: 10 }, (_, i) => ws(`w${i}`)),
      stepFiles: files,
      criteria: null,
      moduleOf: noModule,
      cores: 8,
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
