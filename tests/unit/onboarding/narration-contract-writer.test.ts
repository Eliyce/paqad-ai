import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MANAGED_HEADER } from '@/onboarding/decision-pause-contract-writer.js';
import {
  buildNarrationContractDocument,
  writeNarrationContractDocument,
} from '@/onboarding/narration-contract-writer.js';
import { PAQAD_TERM_TRANSLATIONS, PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-narration-contract-'));
}

describe('narration-contract-writer', () => {
  it('emits the managed header so accidental edits are flagged', () => {
    expect(buildNarrationContractDocument().startsWith(MANAGED_HEADER)).toBe(true);
  });

  it('documents the cadence, voice, and status-block format', () => {
    const doc = buildNarrationContractDocument();
    expect(doc).toContain('## When paqad speaks (cadence)');
    expect(doc).toContain('Handshake');
    expect(doc).toContain('## Voice');
    expect(doc).toContain('## Status-block format');
    expect(doc).toContain('**▸ paqad**');
  });

  it('reuses the canonical verdict words', () => {
    const doc = buildNarrationContractDocument();
    expect(doc).toContain(PAQAD_VERDICT.pass);
    expect(doc).toContain(PAQAD_VERDICT.fail);
    expect(doc).toContain(PAQAD_VERDICT.inconclusive);
  });

  it('lists every plain-English term translation from the canonical spec', () => {
    const doc = buildNarrationContractDocument();
    for (const { term, plain } of PAQAD_TERM_TRANSLATIONS) {
      expect(doc).toContain(term);
      expect(doc).toContain(plain);
    }
  });

  it('stays legible with the status glyphs stripped', () => {
    const stripped = buildNarrationContractDocument().replace(/[🟢🔴🟡⚪]/gu, '');
    for (const word of ['good', 'failed', 'needs a look', 'skipped']) {
      expect(stripped).toContain(word);
    }
  });

  it('writes the canonical doc on first run', () => {
    const projectRoot = tempProject();
    expect(writeNarrationContractDocument(projectRoot)).toBe(true);
    const target = join(projectRoot, '.paqad/narration-contract.md');
    expect(readFileSync(target, 'utf8')).toBe(buildNarrationContractDocument());
  });

  it('is idempotent — second run does nothing when content unchanged', () => {
    const projectRoot = tempProject();
    expect(writeNarrationContractDocument(projectRoot)).toBe(true);
    const target = join(projectRoot, '.paqad/narration-contract.md');
    const mtimeBefore = statSync(target).mtimeMs;
    expect(writeNarrationContractDocument(projectRoot)).toBe(false);
    expect(statSync(target).mtimeMs).toBe(mtimeBefore);
  });

  it('rewrites the file when content drifted', () => {
    const projectRoot = tempProject();
    const target = join(projectRoot, '.paqad/narration-contract.md');
    writeNarrationContractDocument(projectRoot);
    writeFileSync(target, 'someone hand-edited this file');
    expect(writeNarrationContractDocument(projectRoot)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(buildNarrationContractDocument());
  });
});
