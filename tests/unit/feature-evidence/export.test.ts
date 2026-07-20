import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exportFeatureBundle, pruneFeatureBundles } from '@/feature-evidence/export.js';
import { writeFeaturePlan, writeFeatureReview } from '@/feature-evidence/artifacts.js';
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
      adapter: 'claude-code',
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
    // plan.json parsed as an object.
    expect((bundle.files.plan as { summary?: string }).summary).toBe('do the thing');
    // stage-evidence.jsonl parsed as a row array (open + stage_start).
    expect(Array.isArray(bundle.files.stageEvidence)).toBe(true);
    // Absent files (receipt/ai-bom) are omitted.
    expect(bundle.files.receipt).toBeUndefined();
  });
});

describe('pruneFeatureBundles', () => {
  it('keeps the N most-recent non-live bundles and removes the rest', () => {
    const root = tempRoot();
    // Three features, ULID order 1 < 2 < 3 (time order).
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
    // Pause all so none is "active" (else the active one is always kept).
    pauseActive(root, 'ses_1');
    // Clear the control entirely so a/b/c are not "live" for this retention test.
    rmSync(join(root, '.paqad/ledger/feature-evidence/_session'), { recursive: true, force: true });

    const result = pruneFeatureBundles(root, 1);
    // Only the newest (c) is kept; a + b removed.
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
    // a is paused, b is active — both live.
    const result = pruneFeatureBundles(root, 0);
    expect(result.removed).toEqual([]);
    expect(result.kept.sort()).toEqual([a, b].sort());
  });
});

// Issue #402 — the export reads a fixed allowlist, so a stray never broke it; it was
// simply invisible. It now carries what does not belong so a polluted bundle is visible.
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
    // The stray is reported, never parsed into the document.
    expect(bundle.files.plan).toBeTruthy();
  });

  // AC-8: a bundle written before review.json existed must still export.
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
