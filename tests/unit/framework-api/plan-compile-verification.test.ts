// Issue #397 — the acceptance record for verifying framework reuse claims at plan compile.
// Each describe names the AC it proves, so a regression points straight at the promise it
// broke. Sibling of tests/unit/feature-evidence/reuse.test.ts, which covers Phase A (#357).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FRAMEWORK_API_INDEX_ABSENT_WARNING,
  frameworkClaimKey,
  validateReuseSection,
  type PlanReuse,
} from '@/feature-evidence/reuse.js';
import { writeFrameworkApiIndex } from '@/framework-api/store.js';
import { FRAMEWORK_API_SCHEMA_VERSION, type FrameworkApiSymbol } from '@/framework-api/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-framework-verify-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A stack snapshot whose `locked_version` agrees with the claim, so Phase A passes. */
function withSnapshot(root: string, name: string, version: string): void {
  const target = join(root, '.paqad/stack-snapshot.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      generated_at: '2026-07-20T00:00:00.000Z',
      source_hashes: {},
      toolchains: [],
      packages: [
        {
          name,
          version_constraint: `^${version}`,
          locked_version: version,
          ecosystem: 'node',
          is_dev: false,
        },
      ],
      profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
    }),
    'utf8',
  );
}

function symbol(overrides: Partial<FrameworkApiSymbol> & { name: string }): FrameworkApiSymbol {
  return {
    kind: 'function',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'asserted',
    ...overrides,
  };
}

function withFrameworkIndex(root: string, version: string, symbols: FrameworkApiSymbol[]): void {
  writeFrameworkApiIndex(root, {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: { generated_at: '2026-01-01T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: 'react',
        version,
        ecosystem: 'node',
        root: '.',
        content_hash: 'sha256:test',
        sources: [],
        symbols,
      },
    ],
    blocked: [],
  });
}

/** A reuse section making one framework-native claim on react. */
function claiming(symbolName: string, version = '19.2.6'): PlanReuse {
  return {
    consulted: [
      { source: 'framework-api', query: symbolName, target: `react@${version}`, hits: 1 },
    ],
    reusing: [{ symbol: symbolName, how: 'call as-is', package: 'react', version }],
    new_constructs: [],
  };
}

describe('a verified framework claim', () => {
  it('compiles clean and records the computed provenance', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'useId' })]);

    const result = validateReuseSection({ projectRoot: root, reuse: claiming('useId'), steps: [] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.provenance[frameworkClaimKey('react', 'useId')]).toBe('asserted');
  });
});

describe('AC-3 — a framework symbol absent at the installed version fails the compile', () => {
  it('fails and suggests the nearest existing symbol', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'useId' })]);

    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming('useIdd'),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not exist in react@19.2.6');
    expect(result.errors[0]).toContain('did you mean "useId"?');
  });

  it('fails without a suggestion when nothing is close', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'useId' })]);

    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming('completelyUnrelatedThing'),
      steps: [],
    });
    expect(result.errors[0]).toContain('does not exist in react@19.2.6');
    expect(result.errors[0]).not.toContain('did you mean');
  });
});

describe('AC-4 — a deprecated framework symbol fails the compile', () => {
  it('cites the deprecation message, the version, and the removal warning', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [
      symbol({
        name: 'componentWillMount',
        deprecated: true,
        message: 'use componentDidMount instead.',
        since: '16.3',
        for_removal: true,
      }),
    ]);

    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming('componentWillMount'),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('is deprecated in react@19.2.6');
    expect(result.errors[0]).toContain('deprecated since 16.3');
    expect(result.errors[0]).toContain('use componentDidMount instead.');
    expect(result.errors[0]).toContain('slated for removal');
  });

  it('still fails when the tag carried no message or version', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'old', deprecated: true })]);

    const result = validateReuseSection({ projectRoot: root, reuse: claiming('old'), steps: [] });
    expect(result.errors[0]).toContain('is deprecated in react@19.2.6');
    expect(result.errors[0]).toContain('no reason given');
    expect(result.errors[0]).not.toContain('slated for removal');
  });
});

describe('AC-5 — a dynamic member warns and is never called absent', () => {
  it('warns, does not block, and records unknown-dynamic provenance', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');
    withFrameworkIndex(root, '19.2.6', [
      symbol({ name: 'Component.*', kind: 'member', provenance: 'unknown-dynamic' }),
    ]);

    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming('Component.render'),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain('is provided dynamically by react@19.2.6');
    expect(result.provenance[frameworkClaimKey('react', 'Component.render')]).toBe(
      'unknown-dynamic',
    );
  });
});

describe('AC-6 — an absent index warns rather than blocking', () => {
  it('emits the documented warning and lets the compile proceed', () => {
    const root = tempRoot();
    withSnapshot(root, 'react', '19.2.6');

    const result = validateReuseSection({ projectRoot: root, reuse: claiming('useId'), steps: [] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(FRAMEWORK_API_INDEX_ABSENT_WARNING);
    expect(result.provenance).toEqual({});
  });

  it('warns when the index exists but does not cover the claimed package', () => {
    const root = tempRoot();
    withSnapshot(root, 'vue', '3.5.0');
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'useId' })]);

    const reuse: PlanReuse = {
      consulted: [{ source: 'framework-docs', query: 'ref', hits: 1 }],
      reusing: [{ symbol: 'ref', how: 'call as-is', package: 'vue', version: '3.5.0' }],
      new_constructs: [],
    };
    const result = validateReuseSection({ projectRoot: root, reuse, steps: [] });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('not in the framework-api index');
  });
});

describe('the verifier stays out of the way of everything else', () => {
  it('does nothing when the plan makes no framework claim', () => {
    const root = tempRoot();
    withFrameworkIndex(root, '19.2.6', [symbol({ name: 'useId' })]);

    const result = validateReuseSection({
      projectRoot: root,
      reuse: {
        consulted: [{ source: 'grep', query: 'dates', hits: 1 }],
        reusing: [],
        new_constructs: [],
      },
      steps: [],
    });
    expect(result.warnings).toEqual([]);
    expect(result.provenance).toEqual({});
  });

  it('never runs when the section is structurally invalid', () => {
    const result = validateReuseSection({ projectRoot: tempRoot(), reuse: undefined, steps: [] });
    expect(result.provenance).toEqual({});
  });
});
