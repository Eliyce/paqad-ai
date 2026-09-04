import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { writeFeaturePlan, writeFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { closeActiveFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-feature-wiring-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-09-04T00:00:00.000Z');

describe('feature.json wiring (issue #511)', () => {
  it('openFeatureChange seeds feature.json with the adapter + lane', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      lane: 'full',
      title: 'Ship the thing',
      issue: '511',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      now: clock,
    });
    const record = readFeatureRecord(root, dir);
    expect(record).not.toBeNull();
    expect(record!.adapter).toBe('claude-code');
    expect(record!.lane).toBe('full');
    expect(record!.issue).toBe('511');
    expect(record!.status).toBe('active');
  });

  it('closeActiveFeature flips feature.json status to done', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Ship it',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
      now: clock,
    });
    closeActiveFeature(root, 'ses_1', clock);
    expect(readFeatureRecord(root, dir)!.status).toBe('done');
  });

  it('plan compile lifts an untitled bundle out of the placeholder identity', () => {
    const root = tempRoot();
    // Open untitled (no title) → change-<ULID> with the `change` placeholder.
    const untitled = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
      now: clock,
    });
    expect(readFeatureRecord(root, untitled)!.title).toBe('change');

    const compiled = writeFeaturePlan(root, 'ses_1', {
      summary: 'do a thing',
      title: 'Make the map readable',
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      now: clock,
    });
    const record = readFeatureRecord(root, compiled.dirName);
    expect(record!.title).toBe('Make the map readable');
    expect(record!.slug).toBe('make-the-map-readable');
  });

  it('spec freeze records the spec_id on feature.json', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Feature X',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ3',
      now: clock,
    });
    const spec: FeatureSpec = {
      schema_version: '1',
      spec_id: 'spec-x',
      spec_file: '.paqad/spec.md',
      spec_hash: 'abc',
      behaviour: [],
      acceptance_criteria: [],
      invariants: [],
      open_questions: [],
      frozen: { frozen_at: '2026-09-04T00:00:00.000Z', signed_off_by: 'me', spec_review: null },
    };
    writeFeatureSpecification(root, 'ses_1', spec);
    expect(readFeatureRecord(root, dir)!.spec_id).toBe('spec-x');
  });
});
