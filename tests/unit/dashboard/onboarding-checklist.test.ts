import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildOnboardingChecklist } from '@/dashboard/onboarding-checklist.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { featureFilePath, formatFeatureDirName } from '@/feature-evidence/paths.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

// Issue #468 Phase B — the checklist reads the first passing gate and the first receipt from
// the per-feature bundle union, so tests seed a bundle `evidence.jsonl` / `receipt.json`.
function seedBundleGate(root: string, verdict: 'pass' | 'fail'): void {
  const dir = formatFeatureDirName({ issue: null, slug: 'x', ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const path = join(root, featureFilePath(dir, 'evidence'));
  mkdirSync(dirname(path), { recursive: true });
  const evidence = buildEvidenceRow({
    ts: '2026-06-11T00:00:00.000Z',
    engine: 'verification-gate',
    code: 'tests',
    subject_digest: 's',
    verdict,
    strength_class: 'deterministic',
  });
  writeFileSync(path, `${JSON.stringify(evidence)}\n`, 'utf8');
}

function seedBundleReceipt(root: string): void {
  const dir = formatFeatureDirName({ issue: null, slug: 'r', ulid: '01BX5ZZKBKACTAV9WEVGEMMVRZ' });
  const path = join(root, featureFilePath(dir, 'receipt'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ payload: 'x', paqad: { receipt_hash: 'h' } }), 'utf8');
}

function step(root: string, key: string) {
  const checklist = buildOnboardingChecklist(root);
  const found = checklist.steps.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing step ${key}`);
  return found;
}

describe('buildOnboardingChecklist', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-checklist-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('starts with nothing done and helpful next-step copy', () => {
    const checklist = buildOnboardingChecklist(root);
    expect(checklist.steps).toHaveLength(5);
    expect(checklist.steps.every((item) => !item.done)).toBe(true);
    expect(checklist.complete).toBe(false);
    expect(checklist.receiptAvailable).toBe(false);
    for (const item of checklist.steps) {
      expect(item.detail.includes('—'), `${item.key} copy`).toBe(false);
      expect(item.detail.includes('!'), `${item.key} copy`).toBe(false);
    }
  });

  it('completes connect-agent when an entry file and the manifest exist', () => {
    write(root, 'CLAUDE.md', '# entry');
    write(root, '.paqad/onboarding-manifest.json', '{}');
    expect(step(root, 'connect-agent').done).toBe(true);
  });

  it('completes first-gate from a passing bundle evidence row', () => {
    seedBundleGate(root, 'pass');
    expect(step(root, 'first-gate').done).toBe(true);
  });

  it('does not complete first-gate from failures alone', () => {
    seedBundleGate(root, 'fail');
    expect(step(root, 'first-gate').done).toBe(false);
  });

  it('completes first-decision from a resolved decision file', () => {
    write(root, '.paqad/decisions/resolved/D-1.json', '{}');
    expect(step(root, 'first-decision').done).toBe(true);
  });

  it('keeps first-receipt server-side incomplete but flags availability', () => {
    seedBundleReceipt(root);
    const checklist = buildOnboardingChecklist(root);
    expect(checklist.receiptAvailable).toBe(true);
    expect(step(root, 'first-receipt').done).toBe(false);
    expect(step(root, 'first-receipt').detail).toContain('waiting in Trust');
  });

  it('completes edit-instruction from the dashboard audit line', () => {
    write(
      root,
      '.paqad/audit.log',
      '[2026-06-12T00:00:00Z] INFO dashboard.instructions.write actor="dashboard"\n',
    );
    expect(step(root, 'edit-instruction').done).toBe(true);
  });

  it('reports complete when every server-knowable step is done', () => {
    write(root, 'CLAUDE.md', '# entry');
    write(root, '.paqad/onboarding-manifest.json', '{}');
    seedBundleGate(root, 'pass');
    write(root, '.paqad/decisions/resolved/D-1.json', '{}');
    write(
      root,
      '.paqad/audit.log',
      '[2026-06-12T00:00:00Z] INFO dashboard.instructions.write actor="dashboard"\n',
    );
    expect(buildOnboardingChecklist(root).complete).toBe(true);
  });
});
