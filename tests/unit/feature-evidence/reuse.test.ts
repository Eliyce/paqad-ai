// Issue #357 — the plan reuse gate. These tests are the AC record for Phase A: each
// `describe` names the acceptance criterion it proves, so a regression points straight at
// the promise it broke.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CREATE_KEYWORDS,
  INDEX_ABSENT_WARNING,
  SNAPSHOT_ABSENT_WARNING,
  reuseCounts,
  validateReuseSection,
  type PlanReuse,
} from '@/feature-evidence/reuse.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-reuse-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeJson(root: string, relative: string, value: unknown): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value), 'utf8');
}

/** A code-knowledge index carrying exactly the named symbols. */
function withIndex(root: string, names: string[]): void {
  writeJson(root, '.paqad/indexes/code-knowledge.json', {
    schema_version: 1,
    header: {
      generated_at: '2026-07-20T00:00:00.000Z',
      branch: 'main',
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: names.map((name) => ({
      name,
      kind: 'function',
      file: 'src/utils/dates.ts',
      line: 1,
      signature: `${name}()`,
      exported: true,
      module_slug: null,
      extraction_tier: 'regex',
      caller_count: 1,
      orphan: false,
    })),
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  });
}

/** A stack snapshot carrying one resolved package. */
function withSnapshot(root: string, name: string, lockedVersion: string): void {
  writeJson(root, '.paqad/stack-snapshot.json', {
    generated_at: '2026-07-20T00:00:00.000Z',
    source_hashes: {},
    toolchains: [],
    packages: [
      {
        name,
        version_constraint: `^${lockedVersion}`,
        locked_version: lockedVersion,
        ecosystem: 'php',
        is_dev: false,
      },
    ],
    profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
  });
}

/** A project profile declaring the given detected frameworks. */
function withFrameworks(root: string, frameworks: string[]): void {
  const target = join(root, '.paqad/project-profile.yaml');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `stack_profile:\n  frameworks:\n${frameworks.map((f) => `    - ${f}`).join('\n')}\n`,
    'utf8',
  );
}

function base(overrides: Partial<PlanReuse> = {}): PlanReuse {
  return {
    consulted: [{ source: 'index-query', query: 'date formatting', hits: 2 }],
    reusing: [],
    new_constructs: [],
    ...overrides,
  };
}

describe('AC-1 — a plan template without a reuse section does not compile', () => {
  it('names the missing section and shows the expected shape', () => {
    const result = validateReuseSection({ projectRoot: tempRoot(), reuse: undefined, steps: [] });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing the required "reuse" section');
    expect(result.errors[0]).toContain('"consulted"');
    expect(result.errors[0]).toContain('"new_constructs"');
  });

  it('rejects a null or non-object reuse section', () => {
    const root = tempRoot();
    expect(validateReuseSection({ projectRoot: root, reuse: null, steps: [] }).errors[0]).toContain(
      'missing the required "reuse" section',
    );
    expect(validateReuseSection({ projectRoot: root, reuse: [], steps: [] }).errors).toEqual([
      'plan template "reuse" must be an object',
    ]);
    expect(validateReuseSection({ projectRoot: root, reuse: 'nope', steps: [] }).errors).toEqual([
      'plan template "reuse" must be an object',
    ]);
  });

  it('requires at least one consulted entry', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base({ consulted: [] }),
      steps: [],
    });
    expect(result.errors[0]).toContain('reuse.consulted');
  });

  it('rejects a non-array reusing or new_constructs', () => {
    const root = tempRoot();
    const errors = validateReuseSection({
      projectRoot: root,
      reuse: { consulted: [{ source: 'grep', query: 'x', hits: 0 }], reusing: 'no', new_constructs: 'no' },
      steps: [],
    }).errors;
    expect(errors).toContain('plan template "reuse.reusing" must be an array');
    expect(errors).toContain('plan template "reuse.new_constructs" must be an array');
  });
});

describe('AC-2 — an unknown first-party symbol fails with a nearest-match suggestion', () => {
  it('suggests the nearest existing symbol', () => {
    const root = tempRoot();
    withIndex(root, ['formatIsoDate', 'parseDuration']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({ reusing: [{ symbol: 'formatIsoDat', how: 'call as-is' }] }),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('did you mean "formatIsoDate"?');
  });

  it('says so plainly when nothing is close, rather than suggesting an unrelated symbol', () => {
    const root = tempRoot();
    withIndex(root, ['formatIsoDate']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({ reusing: [{ symbol: 'zzzzzzzzzzzzQuux', how: 'call as-is' }] }),
      steps: [],
    });
    expect(result.errors[0]).toContain('not in the code-knowledge index');
    expect(result.errors[0]).not.toContain('did you mean');
  });

  it('accepts a symbol that exists', () => {
    const root = tempRoot();
    withIndex(root, ['formatIsoDate']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        reusing: [{ symbol: 'formatIsoDate', file: 'src/utils/dates.ts', how: 'call as-is' }],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('AC-3 — an absent index warns instead of blocking', () => {
  it('accepts the claim and emits the documented warning', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base({ reusing: [{ symbol: 'whateverThisIs', how: 'call as-is' }] }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([INDEX_ABSENT_WARNING]);
  });

  it('does not read the index at all when there are no first-party claims', () => {
    const result = validateReuseSection({ projectRoot: tempRoot(), reuse: base(), steps: [] });
    expect(result.warnings).toEqual([]);
  });
});

describe('AC-4 — create-keyword steps must declare or justify a new construct', () => {
  it('fails when a step creates something and new_constructs is empty', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base(),
      steps: [{ description: 'Add a helper for relative dates' }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('declare the new construct and justify it');
  });

  it('passes once the construct is declared', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base({
        new_constructs: [
          { name: 'formatRelativeDate', justification: 'no existing helper handles this' },
        ],
      }),
      steps: [{ description: 'Add a helper for relative dates' }],
    });
    expect(result.errors).toEqual([]);
  });

  it('ignores a step that creates nothing exported', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base(),
      steps: [{ description: 'Add a test for the router' }, {}],
    });
    expect(result.errors).toEqual([]);
  });

  it('keeps the keyword list tunable in one exported constant', () => {
    expect(CREATE_KEYWORDS).toContain('add helper');
    expect(CREATE_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe('AC-8 — a detected framework demands the framework check on a new construct', () => {
  it('fails when neither framework_checked nor a naming justification is present', () => {
    const root = tempRoot();
    withFrameworks(root, ['laravel']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        new_constructs: [{ name: 'Slugger', justification: 'we need our own' }],
      }),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('must record the framework check');
    expect(result.errors[0]).toContain('laravel');
  });

  it('passes once framework_checked is added', () => {
    const root = tempRoot();
    withFrameworks(root, ['laravel']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        new_constructs: [
          {
            name: 'Slugger',
            justification: 'we need our own',
            framework_checked: { package: 'laravel/framework', nearest: 'Str::slug', verdict: 'insufficient' },
          },
        ],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
  });

  it('accepts a justification that names the framework itself', () => {
    const root = tempRoot();
    withFrameworks(root, ['laravel']);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        new_constructs: [
          { name: 'Slugger', justification: 'Laravel ships no equivalent with these semantics' },
        ],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
  });
});

describe('AC-9 — a framework claim must agree with the resolved stack snapshot', () => {
  it('fails naming the detected version on a mismatch', () => {
    const root = tempRoot();
    withSnapshot(root, 'laravel/framework', '10.48.2');
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        reusing: [
          { symbol: 'Str::of', package: 'laravel/framework', version: '9.0.0', how: 'use slug()' },
        ],
      }),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('claims laravel/framework@9.0.0; stack has 10.48.2');
  });

  it('passes when the version agrees', () => {
    const root = tempRoot();
    withSnapshot(root, 'laravel/framework', '10.48.2');
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        reusing: [
          { symbol: 'Str::of', package: 'laravel/framework', version: '10.48.2', how: 'use slug()' },
        ],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
  });

  it('requires a version on a framework claim', () => {
    const root = tempRoot();
    withSnapshot(root, 'laravel/framework', '10.48.2');
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        reusing: [{ symbol: 'Str::of', package: 'laravel/framework', how: 'use slug()' }],
      }),
      steps: [],
    });
    expect(result.errors[0]).toContain('sets no "version"');
  });

  it('fails when the package is not in the snapshot at all', () => {
    const root = tempRoot();
    withSnapshot(root, 'laravel/framework', '10.48.2');
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({
        reusing: [{ symbol: 'X::y', package: 'nope/nope', version: '1.0.0', how: 'use it' }],
      }),
      steps: [],
    });
    expect(result.errors[0]).toContain('not in the stack snapshot');
  });

  it('warns rather than blocks when no snapshot has been built', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base({
        reusing: [
          { symbol: 'Str::of', package: 'laravel/framework', version: '10.48.2', how: 'slug()' },
        ],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([SNAPSHOT_ABSENT_WARNING]);
  });
});

describe('AC-10 — a framework-less project carries no new burden', () => {
  it('accepts a new construct with no framework fields', () => {
    const result = validateReuseSection({
      projectRoot: tempRoot(),
      reuse: base({
        new_constructs: [{ name: 'formatRelativeDate', justification: 'nothing similar exists' }],
      }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
  });

  it('treats a profile with an empty framework list as framework-less', () => {
    const root = tempRoot();
    withFrameworks(root, []);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: base({ new_constructs: [{ name: 'Thing', justification: 'needed' }] }),
      steps: [],
    });
    expect(result.errors).toEqual([]);
  });
});

describe('AC-5 — reuse counts for the receipt', () => {
  it('counts what was reused and what is newly justified', () => {
    expect(
      reuseCounts({
        reuse: base({
          reusing: [{ symbol: 'a', how: 'call' }],
          new_constructs: [{ name: 'b', justification: 'because' }],
        }),
      }),
    ).toEqual({ reused: 1, newJustified: 1 });
  });

  it('returns null for a plan compiled before the reuse gate, and for no plan', () => {
    expect(reuseCounts(null)).toBeNull();
    expect(reuseCounts({})).toBeNull();
  });
});
