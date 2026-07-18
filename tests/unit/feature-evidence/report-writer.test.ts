import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeFeaturePlan, writeFeatureReview } from '@/feature-evidence/artifacts.js';
import { featureReportPath } from '@/feature-evidence/paths.js';
import {
  featureReportEnabled,
  resolveReportFeatureRef,
  writeFeatureReport,
} from '@/feature-evidence/report-writer.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-report-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const AT = '2026-07-13T00:00:00.000Z';

function openWithPlan(root: string, ulidSeed: number, title: string): string {
  const dir = openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title,
    issue: null,
    ulidSeed,
  });
  appendFeatureStageRow(root, 'ses_1', dir, {
    kind: 'stage_start',
    stage: 'planning',
    adapter: 'claude-code',
  });
  writeFeaturePlan(root, 'ses_1', { summary: `plan for ${title}`, now: () => new Date(AT) });
  return dir;
}

describe('writeFeatureReport', () => {
  it('renders report.html into the bundle dir and returns its absolute path', () => {
    const root = tempRoot();
    const dir = openWithPlan(root, 1, 'A feature');
    const result = writeFeatureReport(root, dir, { generatedAt: AT, sessionId: 'ses_1' });
    const expected = join(root, featureReportPath(dir));
    expect(result.path).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    const html = readFileSync(expected, 'utf8');
    expect(html).toContain('plan for A feature');
    expect(html).not.toMatch(/<script/i);
  });

  it('renders with a default session label when none is supplied', () => {
    const root = tempRoot();
    const dir = openWithPlan(root, 1, 'Default session');
    const result = writeFeatureReport(root, dir);
    expect(existsSync(result.path)).toBe(true);
  });

  it('honours an absolute --out and a relative --out', () => {
    const root = tempRoot();
    const dir = openWithPlan(root, 1, 'B feature');
    const abs = join(root, 'custom-report.html');
    expect(writeFeatureReport(root, dir, { sessionId: 'ses_1', outPath: abs }).path).toBe(abs);
    expect(existsSync(abs)).toBe(true);
    // A relative --out is resolved against the project root.
    const rel = writeFeatureReport(root, dir, { sessionId: 'ses_1', outPath: 'sub/rep.html' });
    expect(rel.path).toBe(join(root, 'sub/rep.html'));
    expect(existsSync(rel.path)).toBe(true);
  });
});

describe('featureReportEnabled', () => {
  it('defaults report on, and honours the env override', () => {
    const root = tempRoot();
    expect(featureReportEnabled(root, {})).toBe(true);
    expect(featureReportEnabled(root, { PAQAD_FEATURE_REPORT: '0' })).toBe(false);
  });
});

// Issue #402 — the review used to be an agent-authored .md discovered from the review
// stage row, a design that invited the model to free-write into the bundle dir. It is a
// rigid bundle artifact now, so the report reads it like any other.
describe('review rendering from the rigid review.json', () => {
  it('renders the recorded review from review.json', () => {
    const root = tempRoot();
    const dir = openWithPlan(root, 1, 'C feature');
    writeFeatureReview(root, 'ses_1', {
      summary: 'Checked correctness and rollback.',
      verdict: 'safe-to-merge',
      findings: [{ severity: 'minor', description: 'naming nit' }],
      rollback: 'Revert the commit.',
      now: () => new Date(AT),
    });
    const { html } = writeFeatureReport(root, dir, { generatedAt: AT });
    expect(html).toContain('Safe to merge');
    expect(html).toContain('Checked correctness and rollback.');
    expect(html).toContain('naming nit');
  });

  it('shows a graceful note naming the verb when no review was recorded', () => {
    const root = tempRoot();
    const dir = openWithPlan(root, 1, 'D feature');
    const { html } = writeFeatureReport(root, dir, { generatedAt: AT });
    expect(html).toContain('paqad-ai review record');
  });
});

describe('resolveReportFeatureRef', () => {
  it('defaults to the active feature, then the most recent by ULID, and resolves an explicit ref', () => {
    const root = tempRoot();
    const a = openWithPlan(root, 1, 'First');
    const b = openWithPlan(root, 2, 'Second'); // b is now active, newer ULID
    // No ref → active feature (b).
    expect(resolveReportFeatureRef(root, 'ses_1', undefined, b)).toBe(b);
    // No ref, no active → most recent by ULID (b).
    expect(resolveReportFeatureRef(root, 'ses_1', undefined, null)).toBe(b);
    // Explicit ref by slug substring resolves the older one (a) via whole-tree scan.
    expect(resolveReportFeatureRef(root, 'ses_1', 'first', null)).toBe(a);
    // Unknown ref → null.
    expect(resolveReportFeatureRef(root, 'ses_1', 'nope-nothing', null)).toBeNull();
  });

  it('resolves an explicit ref by exact dir name and by ULID via the whole-tree scan', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_2', {
      adapter: 'claude-code',
      title: 'Ref target',
      issue: '371',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    // Different session so the session-control resolver misses → whole-tree scan hits.
    expect(resolveReportFeatureRef(root, 'other-ses', dir, null)).toBe(dir);
    expect(resolveReportFeatureRef(root, 'other-ses', '01JABCDEFGHJKMNPQRSTVWXYZ0', null)).toBe(
      dir,
    );
    expect(resolveReportFeatureRef(root, 'other-ses', '371', null)).toBe(dir);
    expect(resolveReportFeatureRef(root, 'other-ses', '#371', null)).toBe(dir);
  });

  it('returns null with no ref, no active feature, and no bundles on disk', () => {
    const root = tempRoot();
    expect(resolveReportFeatureRef(root, 'ses_1', undefined, null)).toBeNull();
  });
});
