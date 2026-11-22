import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { SlicingRuleError, writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import type { Workstream } from '@/planning/slicing.js';

import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-slicing-compile-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function ws(id: string, extra: Partial<Workstream> = {}): Partial<Workstream> {
  return { id, owned_files: [`src/${id}/**`, `tests/${id}/**`], ...extra };
}

const REUSE = {
  consulted: [{ source: 'grep' as const, query: 'x', hits: 0 }],
  reusing: [],
  new_constructs: [],
};

function moduleMap(root: string, yaml: string): void {
  const path = join(root, PATHS.MODULE_MAP);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml);
}

function compileError(run: () => void): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof SlicingRuleError) return error.errors;
    throw error;
  }
  return [];
}

describe('plan compile reads module ownership through the module map (AC-1)', () => {
  it('AC-1 refuses a workstream whose files fall in two modules, by the longest matching source', () => {
    const root = project();
    openChange(root, 'ses-mm');
    moduleMap(
      root,
      [
        'modules:',
        '  - slug: core',
        "    sources: ['./src/a/', '']",
        '  - slug: inner',
        '    sources: [src/a/deep]',
        '  - slug: other',
        '    sources: [src/b]',
      ].join('\n'),
    );
    const errors = compileError(() =>
      writeFeaturePlan(root, 'ses-mm', {
        summary: 'split',
        reuse: REUSE,
        steps: [
          {
            id: 'S1',
            description: 'x',
            files: ['src/a/x.ts', 'src/a/deep/y.ts', 'src/b', 'src/b/z.ts', 'src/c/w.ts'],
          },
        ],
        workstreams: [ws('a'), ws('b'), ws('c')],
      }),
    );
    expect(errors).toEqual(['slicing rule module-map: a']);
  });

  it('AC-1 compiles without a specification and keeps a declared size budget', () => {
    const root = project();
    const dir = openChange(root, 'ses-nospec');
    moduleMap(root, 'modules: []\n');
    writeFeaturePlan(root, 'ses-nospec', {
      summary: 'one',
      reuse: REUSE,
      steps: [
        { id: 'S1', description: 'x', files: ['src/a/x.ts'] },
        { id: 'S2', description: 'notes only' },
      ],
      workstreams: [ws('a', { size_budget: { files: 3 } }), ws('b')],
    });
    const plan = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'plan')), 'utf8'));
    expect(plan.workstreams.map((w: Workstream) => w.size_budget)).toEqual([
      { files: 3 },
      { files: 2 },
    ]);
  });

  it('AC-1 gives a workstream of a step-less plan a zero file budget', () => {
    const root = project();
    const dir = openChange(root, 'ses-nosteps');
    writeFeaturePlan(root, 'ses-nosteps', {
      summary: 'bare',
      reuse: REUSE,
      workstreams: [ws('a')],
    });
    const plan = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'plan')), 'utf8'));
    expect(plan.workstreams[0].size_budget).toEqual({ files: 0 });
  });
});
