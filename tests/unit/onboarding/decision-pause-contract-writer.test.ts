import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { DECISION_CATEGORIES } from '@/planning/decision-packet.js';
import {
  MANAGED_HEADER,
  buildDecisionPauseContractDocument,
  writeDecisionPauseContractDocument,
  writeMarkdownIfChanged,
} from '@/onboarding/decision-pause-contract-writer.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-decision-pause-contract-'));
}

describe('decision-pause-contract-writer', () => {
  it('emits the managed header so accidental edits are flagged', () => {
    const doc = buildDecisionPauseContractDocument();
    expect(doc.startsWith(MANAGED_HEADER)).toBe(true);
  });

  it('lists every category from DECISION_CATEGORIES (no duplication, no drift)', () => {
    const doc = buildDecisionPauseContractDocument();
    for (const category of DECISION_CATEGORIES) {
      expect(doc).toContain(`\`${category}\``);
    }
  });

  it('lists every supported adapter in the per-adapter UI table', () => {
    const doc = buildDecisionPauseContractDocument();
    for (const adapter of ADAPTER_TYPES) {
      expect(doc).toContain(`\`${adapter}\``);
    }
  });

  it('includes the four-step resolution flow and the file-wait fallback', () => {
    const doc = buildDecisionPauseContractDocument();
    expect(doc).toContain('## Resolution flow');
    expect(doc).toContain('chosen');
    expect(doc).toContain('rationale');
    expect(doc).toContain('resolved_at');
    expect(doc).toContain('## Fallback');
  });

  it('writes the canonical doc on first run', () => {
    const projectRoot = tempProject();
    const wrote = writeDecisionPauseContractDocument(projectRoot);
    expect(wrote).toBe(true);
    const target = join(projectRoot, '.paqad/decision-pause-contract.md');
    expect(readFileSync(target, 'utf8')).toBe(buildDecisionPauseContractDocument());
  });

  it('is idempotent — second run does nothing when content unchanged', () => {
    const projectRoot = tempProject();
    expect(writeDecisionPauseContractDocument(projectRoot)).toBe(true);
    const target = join(projectRoot, '.paqad/decision-pause-contract.md');
    const mtimeBefore = statSync(target).mtimeMs;
    expect(writeDecisionPauseContractDocument(projectRoot)).toBe(false);
    expect(statSync(target).mtimeMs).toBe(mtimeBefore);
  });

  it('rewrites the file when content drifted', () => {
    const projectRoot = tempProject();
    const target = join(projectRoot, '.paqad/decision-pause-contract.md');
    writeDecisionPauseContractDocument(projectRoot);
    writeFileSync(target, 'someone hand-edited this file');
    expect(writeDecisionPauseContractDocument(projectRoot)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(buildDecisionPauseContractDocument());
  });

  it('writeMarkdownIfChanged is a no-op when content matches', () => {
    const projectRoot = tempProject();
    const path = join(projectRoot, 'sample.md');
    expect(writeMarkdownIfChanged(path, 'hello')).toBe(true);
    expect(writeMarkdownIfChanged(path, 'hello')).toBe(false);
    expect(writeMarkdownIfChanged(path, 'changed')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('changed');
  });
});
