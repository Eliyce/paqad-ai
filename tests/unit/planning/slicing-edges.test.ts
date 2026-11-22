import { describe, expect, it } from 'vitest';

import {
  computeWaves,
  joiningAreaOf,
  normalizeWorkstream,
  renderSlicingViolation,
  seamJoiningEntry,
  validateSlicing,
  type Workstream,
} from '@/planning/slicing.js';

function ws(id: string, extra: Partial<Workstream> = {}): Partial<Workstream> {
  return { id, owned_files: [`src/${id}/**`, `tests/${id}/**`], ...extra };
}

describe('slicing edges', () => {
  it('AC-1 fills every missing workstream field with an empty, high-risk, unbounded default', () => {
    expect(normalizeWorkstream({})).toEqual({
      id: '',
      owned_files: [],
      acs: [],
      depends_on: [],
      provides_seams: [],
      uses_seams: [],
      risk: 'high',
      size_budget: { files: Number.POSITIVE_INFINITY },
    });
  });

  it('AC-15 sorts lead files into docs, gate-configs, view and wiring joining areas', () => {
    expect(joiningAreaOf('docs/a.txt')).toBe('docs');
    expect(joiningAreaOf('README.md')).toBe('docs');
    expect(joiningAreaOf('.paqad/project-profile.json')).toBe('gate-configs');
    expect(joiningAreaOf('ci.yaml')).toBe('gate-configs');
    expect(joiningAreaOf('pnpm-workspace.toml')).toBe('gate-configs');
    expect(joiningAreaOf('vitest.config.ts')).toBe('gate-configs');
    expect(joiningAreaOf('src/app.tsx')).toBe('view');
    expect(joiningAreaOf('src/hud/line.ts')).toBe('view');
    expect(joiningAreaOf('src/index.ts')).toBe('wiring');
  });

  it('AC-3 stops placing waves once only a cycle remains', () => {
    const a = normalizeWorkstream(ws('a', { depends_on: ['b'] }));
    const b = normalizeWorkstream(ws('b', { depends_on: ['a'] }));
    const c = normalizeWorkstream(ws('c', { depends_on: ['gone'] }));
    expect(computeWaves([a, b, c], 4)).toEqual([['c']]);
  });

  it('AC-1 AC-25 names an unknown dependency once, lets routine work on plain files and keeps the waves empty', () => {
    const result = validateSlicing({
      workstreams: [ws('a', { depends_on: ['gone', 'gone'], risk: 'routine' })],
      stepFiles: ['src/a/x.ts'],
      criteria: null,
      moduleOf: () => null,
      cores: 4,
    });
    expect(result.violations.map(renderSlicingViolation)).toEqual([
      'slicing rule acyclic: a -> gone',
    ]);
    expect(result.waves).toEqual([]);
  });

  it('AC-17 a seam has no joining entry when the plan has no wiring area or entry owner', () => {
    const seam = { name: 'rows', entry_file: 'src/rows.ts', wired_ac: 'AC-2' };
    expect(
      seamJoiningEntry(seam, [{ id: 'join-docs', area: 'docs', owned_files: ['a.md'] }]),
    ).toBeNull();
  });
});
