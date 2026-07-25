// Issue #397, FR-4/FR-8 — the computed provenance reaches the STORED plan.
//
// The verification is only worth having if the record it produces survives into
// `plan.json`: that is what turns #357's model-declared `provenance` into a fact a
// reviewer, a receipt, and a future `git blame` can rely on.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readFeaturePlan, writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import type { PlanReuse } from '@/feature-evidence/reuse.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeFrameworkApiIndex } from '@/framework-api/store.js';
import { FRAMEWORK_API_SCHEMA_VERSION, type FrameworkApiSymbol } from '@/framework-api/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-plan-provenance-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-25T00:00:00.000Z');

function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Framework reuse',
    issue: '397',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

function withSnapshot(root: string): void {
  const target = join(root, '.paqad/stack-snapshot.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      generated_at: '2026-01-01T00:00:00.000Z',
      source_hashes: {},
      toolchains: [],
      packages: [
        {
          name: 'react',
          version_constraint: '^19.0.0',
          locked_version: '19.2.6',
          ecosystem: 'node',
          is_dev: false,
        },
      ],
      profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
    }),
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

function withFrameworkIndex(root: string, symbols: FrameworkApiSymbol[]): void {
  writeFrameworkApiIndex(root, {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: { generated_at: '2026-01-01T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: 'react',
        version: '19.2.6',
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

function reuseWith(reusing: PlanReuse['reusing']): PlanReuse {
  return {
    consulted: [{ source: 'framework-api', query: 'react api', target: 'react@19.2.6', hits: 1 }],
    reusing,
    new_constructs: [],
  };
}

describe('the computed provenance is written onto the stored plan', () => {
  it('overrides a model-declared provenance with the verified one', () => {
    const root = tempRoot();
    const dirName = activeFeature(root);
    withSnapshot(root);
    withFrameworkIndex(root, [symbol({ name: 'useId' })]);

    writeFeaturePlan(root, 'ses_1', {
      summary: 'use the framework hook',
      // The model claimed doc-derived; the index resolved it, so `asserted` must win.
      reuse: reuseWith([
        {
          symbol: 'useId',
          how: 'call as-is',
          package: 'react',
          version: '19.2.6',
          provenance: 'doc-derived',
        },
      ]),
      now: clock,
    });

    const stored = readFeaturePlan(root, dirName);
    expect(stored?.reuse?.reusing[0]?.provenance).toBe('asserted');
  });

  it('records unknown-dynamic for a claim the index could not resolve statically', () => {
    const root = tempRoot();
    const dirName = activeFeature(root);
    withSnapshot(root);
    withFrameworkIndex(root, [
      symbol({ name: 'Component.*', kind: 'member', provenance: 'unknown-dynamic' }),
    ]);

    writeFeaturePlan(root, 'ses_1', {
      summary: 'call a dynamic member',
      reuse: reuseWith([
        { symbol: 'Component.render', how: 'call as-is', package: 'react', version: '19.2.6' },
      ]),
      now: clock,
    });

    expect(readFeaturePlan(root, dirName)?.reuse?.reusing[0]?.provenance).toBe('unknown-dynamic');
  });

  it('leaves a first-party claim untouched', () => {
    const root = tempRoot();
    const dirName = activeFeature(root);
    withSnapshot(root);
    withFrameworkIndex(root, [symbol({ name: 'useId' })]);

    writeFeaturePlan(root, 'ses_1', {
      summary: 'mix first-party and framework reuse',
      reuse: reuseWith([
        { symbol: 'useId', how: 'call as-is', package: 'react', version: '19.2.6' },
        { symbol: 'formatIsoDate', file: 'src/utils/dates.ts', how: 'call as-is' },
      ]),
      now: clock,
    });

    const stored = readFeaturePlan(root, dirName);
    expect(stored?.reuse?.reusing[0]?.provenance).toBe('asserted');
    expect(stored?.reuse?.reusing[1]?.provenance).toBeUndefined();
  });

  it('keeps the declared provenance when no index was built to override it', () => {
    const root = tempRoot();
    const dirName = activeFeature(root);
    withSnapshot(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'no framework-api index in this project',
      reuse: reuseWith([
        {
          symbol: 'useId',
          how: 'call as-is',
          package: 'react',
          version: '19.2.6',
          provenance: 'doc-derived',
        },
      ]),
      now: clock,
    });

    expect(result.warnings.join(' ')).toContain('framework-api index not built');
    expect(readFeaturePlan(root, dirName)?.reuse?.reusing[0]?.provenance).toBe('doc-derived');
  });

  it('stores a first-party-only plan exactly as before (no framework claims to compute)', () => {
    const root = tempRoot();
    const dirName = activeFeature(root);
    withFrameworkIndex(root, [symbol({ name: 'useId' })]);

    writeFeaturePlan(root, 'ses_1', {
      summary: 'no framework claims at all',
      reuse: {
        consulted: [{ source: 'grep', query: 'dates', hits: 1 }],
        reusing: [],
        new_constructs: [],
      },
      now: clock,
    });

    expect(readFeaturePlan(root, dirName)?.reuse?.reusing).toEqual([]);
  });
});
