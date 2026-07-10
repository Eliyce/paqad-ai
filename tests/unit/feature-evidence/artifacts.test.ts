import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NoActiveFeatureError,
  readFeaturePlan,
  readFeatureSpecification,
  writeFeaturePlan,
  writeFeatureSpecification,
} from '@/feature-evidence/artifacts.js';
import { validatePlanRecord } from '@/feature-evidence/schema.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-artifacts-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-10T00:00:00.000Z');

/** Open an active feature and return its dir name. */
function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Route first workflows',
    issue: '339',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

function frozenSpec(): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-339',
    spec_file: '.paqad/specs/S-339.md',
    spec_hash: 'a'.repeat(64),
    behaviour: ['does the thing'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: { frozen_at: clock().toISOString(), spec_hash: 'a'.repeat(64), signed_off_by: 'me' },
  };
}

describe('writeFeaturePlan', () => {
  it('compiles a schema-valid plan.json into the active feature, keyed by the dir name', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Route every prompt to one of nine workflows',
      steps: [{ id: 's1', description: 'add the router' }],
      modules_touched: ['pipeline'],
      now: clock,
    });
    expect(result.dirName).toBe(dir);
    expect(result.path).toBe(`.paqad/ledger/feature-evidence/${dir}/plan.json`);
    // Identity comes from the dir name, not the model.
    expect(result.record).toMatchObject({ issue: '339', slug: 'route-first-workflows' });
    expect(validatePlanRecord(result.record)).toEqual([]);
    const readBack = readFeaturePlan(root, dir);
    expect(readBack?.content_hash).toBe(result.record.content_hash);
  });

  it('throws NoActiveFeatureError when no feature is active', () => {
    const root = tempRoot();
    expect(() => writeFeaturePlan(root, 'ses_1', { summary: 'x' })).toThrow(NoActiveFeatureError);
  });
});

describe('writeFeatureSpecification', () => {
  it('writes a frozen spec as specification.json in the active feature', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const result = writeFeatureSpecification(root, 'ses_1', frozenSpec());
    expect(result.path).toBe(`.paqad/ledger/feature-evidence/${dir}/specification.json`);
    expect(readFeatureSpecification(root, dir)?.spec_id).toBe('S-339');
  });

  it('refuses an unfrozen spec', () => {
    const root = tempRoot();
    activeFeature(root);
    expect(() =>
      writeFeatureSpecification(root, 'ses_1', { ...frozenSpec(), frozen: null }),
    ).toThrow(/unfrozen/);
  });

  it('throws NoActiveFeatureError when no feature is active', () => {
    const root = tempRoot();
    expect(() => writeFeatureSpecification(root, 'ses_1', frozenSpec())).toThrow(
      NoActiveFeatureError,
    );
  });

  it('reads null for an absent specification.json', () => {
    expect(readFeatureSpecification(tempRoot(), 'nope-01JABCDEFGHJKMNPQRSTVWXYZ0')).toBeNull();
  });
});
