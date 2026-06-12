import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildOnboardingChecklist } from '@/dashboard/onboarding-checklist.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
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

  it('completes first-gate from a passing ledger entry', () => {
    write(root, '.paqad/ledger/evidence.jsonl', '{"gate":"tests","verdict":"pass"}\n');
    expect(step(root, 'first-gate').done).toBe(true);
  });

  it('does not complete first-gate from failures alone', () => {
    write(root, '.paqad/ledger/evidence.jsonl', '{"gate":"tests","verdict":"fail"}\n');
    expect(step(root, 'first-gate').done).toBe(false);
  });

  it('completes first-decision from a resolved decision file', () => {
    write(root, '.paqad/decisions/resolved/D-1.json', '{}');
    expect(step(root, 'first-decision').done).toBe(true);
  });

  it('keeps first-receipt server-side incomplete but flags availability', () => {
    write(root, '.paqad/ledger/receipts.jsonl', '{"payload":"x"}\n');
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
    write(root, '.paqad/ledger/evidence.jsonl', '{"verdict":"pass"}\n');
    write(root, '.paqad/decisions/resolved/D-1.json', '{}');
    write(
      root,
      '.paqad/audit.log',
      '[2026-06-12T00:00:00Z] INFO dashboard.instructions.write actor="dashboard"\n',
    );
    expect(buildOnboardingChecklist(root).complete).toBe(true);
  });
});
