import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { frozenSpecPath, readFrozenSpecs, writeFrozenSpec } from '@/spec/frozen-spec-store.js';

function frozenSpec(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-102',
    spec_file: '.paqad/specs/S-102.md',
    spec_hash: 'hash-1',
    behaviour: ['FR-1: does a thing'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: { frozen_at: '2026-06-07T00:00:00Z', spec_hash: 'hash-1', signed_off_by: 'owner' },
    ...overrides,
  };
}

describe('frozen-spec-store', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-frozen-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips a frozen spec through its sidecar', () => {
    const target = writeFrozenSpec(root, frozenSpec());
    expect(target).toBe(frozenSpecPath(root, 'S-102'));
    const specs = readFrozenSpecs(root);
    expect(specs).toHaveLength(1);
    expect(specs[0].spec_id).toBe('S-102');
    expect(specs[0].frozen?.spec_hash).toBe('hash-1');
  });

  it('refuses to persist an unfrozen spec', () => {
    expect(() => writeFrozenSpec(root, frozenSpec({ frozen: null }))).toThrow(/unfrozen/);
  });

  it('returns [] when the specs dir does not exist', () => {
    expect(readFrozenSpecs(root)).toEqual([]);
  });

  it('skips corrupt and non-frozen sidecars but keeps the good ones', () => {
    writeFrozenSpec(root, frozenSpec());
    const dir = join(root, '.paqad/specs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'S-999.frozen.json'), '{ not valid json', 'utf8');
    writeFileSync(
      join(dir, 'S-777.frozen.json'),
      JSON.stringify({ ...frozenSpec({ spec_id: 'S-777' }), frozen: null }),
      'utf8',
    );
    const specs = readFrozenSpecs(root);
    expect(specs.map((spec) => spec.spec_id)).toEqual(['S-102']);
  });
});
