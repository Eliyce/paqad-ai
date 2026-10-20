import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exportFeatureBundle, pruneFeatureBundles } from '@/feature-evidence/export.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { writeFeaturePlan, writeFeatureReview } from '@/feature-evidence/artifacts.js';
import { appendFeatureEvidenceRows } from '@/feature-evidence/bundle-ledgers.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureDir } from '@/feature-evidence/paths.js';
import { pauseActive } from '@/feature-evidence/session-control.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-export-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const AT = '2026-07-10T00:00:00.000Z';

describe('exportFeatureBundle', () => {
  it('collects the feature bundle files into one document (json parsed, jsonl as rows)', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Route first workflows',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    appendFeatureStageRow(root, 'ses_1', dir, {
      kind: 'stage_start',
      stage: 'planning',
    });
    writeFeaturePlan(root, 'ses_1', {
      summary: 'do the thing',
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      now: () => new Date(AT),
    });

    const bundle = exportFeatureBundle(root, dir, AT);
    expect(bundle.dir_name).toBe(dir);
    expect((bundle.files.plan as { summary?: string }).summary).toBe('do the thing');
    expect(Array.isArray(bundle.files.stageEvidence)).toBe(true);
    expect(bundle.files.receipt).toBeUndefined();
  });

  it('exports the .md bundle files as text', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Spec export',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    writeFileSync(join(root, featureDir(dir), 'spec.md'), '---\nx: 1\n---\n# Spec\n', 'utf8');
    const bundle = exportFeatureBundle(root, dir, AT);
    expect(bundle.files.specMd).toBe('---\nx: 1\n---\n# Spec\n');
    expect(bundle.files.request).toBeUndefined();
    expect(bundle.strays).toEqual([]);
    writeFileSync(join(root, featureDir(dir), 'decisions.json'), '{not json', 'utf8');
    expect(exportFeatureBundle(root, dir, AT).files.decisions).toBeUndefined();
  });

  it('exports the graded evidence.jsonl rows', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    const row = buildEvidenceRow({
      ts: AT,
      engine: 'verification-gate',
      code: 'format',
      subject_digest: 's',
      verdict: 'pass',
      strength_class: 'deterministic',
    });
    appendFeatureEvidenceRows(root, 'ses_1', [row]);
    expect(exportFeatureBundle(root, dir, AT).files.evidence).toEqual([
      expect.objectContaining({
        doc_type: 'paqad.evidence',
        recorded_at: AT,
        ts: AT,
        engine: 'verification-gate',
        code: 'format',
        verdict: 'pass',
      }),
    ]);
  });
});

describe('pruneFeatureBundles', () => {
  it('keeps the N most-recent non-live bundles and removes the rest', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
      ulidSeed: 1,
    });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'B',
      issue: null,
      ulidSeed: 2,
    });
    const c = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'C',
      issue: null,
      ulidSeed: 3,
    });
    pauseActive(root, 'ses_1');
    rmSync(join(root, '.paqad/ledger/feature-evidence/_session'), { recursive: true, force: true });

    const result = pruneFeatureBundles(root, 1);
    expect(result.kept).toEqual([c]);
    expect(result.removed.sort()).toEqual([a, b].sort());
    expect(existsSync(join(root, featureDir(a)))).toBe(false);
    expect(existsSync(join(root, featureDir(c)))).toBe(true);
  });

  it('never removes a feature that is active or paused in a session control', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
      ulidSeed: 1,
    });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'B',
      issue: null,
      ulidSeed: 2,
    });
    const result = pruneFeatureBundles(root, 0);
    expect(result.removed).toEqual([]);
    expect(result.kept.sort()).toEqual([a, b].sort());
  });
});

describe('exportFeatureBundle strays', () => {
  function bundleWithPlan(root: string): string {
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Rigid bundle only',
      issue: '402',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    writeFeaturePlan(root, 'ses_1', {
      summary: 'do the thing',
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      now: () => new Date(AT),
    });
    return dir;
  }

  it('reports no strays for a clean bundle', () => {
    const root = tempRoot();
    const dir = bundleWithPlan(root);
    expect(exportFeatureBundle(root, dir, AT).strays).toEqual([]);
  });

  it('reports a stray markdown file without disturbing the parsed files', () => {
    const root = tempRoot();
    const dir = bundleWithPlan(root);
    writeFileSync(join(root, featureDir(dir), 'review-notes.md'), '# notes', 'utf8');
    const bundle = exportFeatureBundle(root, dir, AT);
    expect(bundle.strays).toEqual(['review-notes.md']);
    expect(bundle.files.plan).toBeTruthy();
  });

  it('omits the review key for a bundle that has no review.json', () => {
    const root = tempRoot();
    const dir = bundleWithPlan(root);
    const bundle = exportFeatureBundle(root, dir, AT);
    expect(bundle.files.review).toBeUndefined();
    expect(bundle.strays).toEqual([]);
  });

  it('includes review.json once the review is recorded', () => {
    const root = tempRoot();
    const dir = bundleWithPlan(root);
    writeFeatureReview(root, 'ses_1', {
      summary: 'looks right',
      verdict: 'safe-to-merge',
      rollback: 'revert the commit',
      now: () => new Date(AT),
    });
    const bundle = exportFeatureBundle(root, dir, AT);
    expect((bundle.files.review as { verdict?: string }).verdict).toBe('safe-to-merge');
  });
});
