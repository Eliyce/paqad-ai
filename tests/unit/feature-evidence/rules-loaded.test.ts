import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RuleApplicability } from '@/context/rule-context.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  buildRulesLoadedRecord,
  coverageGaps,
  readRulesLoaded,
  writeRulesLoaded,
  type RulesLoadedRecord,
} from '@/feature-evidence/rules-loaded.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-rules-loaded-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Require rule loading',
    issue: '557',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

const applicable: RuleApplicability[] = [
  { rule_id: 'RULE-2', title: 'Constitution', always_load: true, matched_paths: [] },
  { rule_id: 'RULE-13', title: 'Code Quality', always_load: false, matched_paths: ['src/a.ts'] },
];

describe('buildRulesLoadedRecord', () => {
  it('stamps the doc type, applicable rules, hash and a deterministic identity content_hash', () => {
    const now = () => new Date('2026-09-12T00:00:00.000Z');
    const record = buildRulesLoadedRecord('ses_1', {
      applicable,
      ruleTextHash: 'deadbeef',
      changedPaths: ['src/a.ts'],
      now,
    });
    expect(record.doc_type).toBe('paqad.rules-loaded');
    expect(record.applicable_rules).toEqual(applicable);
    expect(record.rule_text_hash).toBe('deadbeef');
    expect(record.changed_files).toEqual(['src/a.ts']);
    expect(record.artifact).toBe('.paqad/context/session-context.md');
    expect(record.content_hash).toMatch(/^[0-9a-f]{64}$/);
    // content_hash is stable across timestamps (identity excludes created_at).
    const later = buildRulesLoadedRecord('ses_1', {
      applicable,
      ruleTextHash: 'deadbeef',
      changedPaths: ['src/a.ts'],
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(later.content_hash).toBe(record.content_hash);
  });
});

describe('writeRulesLoaded / readRulesLoaded', () => {
  it('returns null when no feature is active (nothing to attach to)', () => {
    const root = tempRoot();
    expect(
      writeRulesLoaded(root, 'ses_1', { applicable, ruleTextHash: 'x', changedPaths: [] }),
    ).toBeNull();
  });

  it('writes rules-loaded.json into the active bundle and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const written = writeRulesLoaded(root, 'ses_1', {
      applicable,
      ruleTextHash: 'abc123',
      changedPaths: ['src/a.ts'],
    });
    expect(written).not.toBeNull();
    const onDisk = readFileSync(join(root, featureFilePath(dir, 'rulesLoaded')), 'utf8');
    expect(JSON.parse(onDisk)).toMatchObject({
      doc_type: 'paqad.rules-loaded',
      rule_text_hash: 'abc123',
    });
    const read = readRulesLoaded(root, dir);
    expect(read?.content_hash).toBe(written?.content_hash);
  });

  it('readRulesLoaded returns null when absent', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(readRulesLoaded(root, dir)).toBeNull();
  });
});

describe('coverageGaps', () => {
  const record = {
    applicable_rules: [{ rule_id: 'RULE-2', title: 'x', always_load: true, matched_paths: [] }],
  } as RulesLoadedRecord;

  it('is empty when the record covers every applicable rule', () => {
    expect(coverageGaps(record, ['RULE-2'])).toEqual([]);
  });

  it('lists applicable rules the record does not cover (a stale load)', () => {
    expect(coverageGaps(record, ['RULE-2', 'RULE-13'])).toEqual(['RULE-13']);
  });

  it('treats an absent record as covering nothing', () => {
    expect(coverageGaps(null, ['RULE-2'])).toEqual(['RULE-2']);
  });
});
