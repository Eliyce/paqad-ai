import { MANAGED_HEADER } from '@/onboarding/decision-pause-contract-writer.js';
import {
  buildNarrationContractBody,
  buildNarrationContractDocument,
} from '@/onboarding/narration-contract-writer.js';
import { PAQAD_TERM_TRANSLATIONS, PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';

describe('narration-contract-writer', () => {
  it('builds a body that starts with the narration-contract heading (no managed header)', () => {
    const body = buildNarrationContractBody();
    expect(body.startsWith('# paqad narration contract')).toBe(true);
    expect(body.startsWith(MANAGED_HEADER)).toBe(false);
  });

  it('documents the cadence, voice, and status-block format', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain('## When paqad speaks (cadence)');
    expect(body).toContain('Handshake');
    expect(body).toContain('## Voice');
    expect(body).toContain('## Status-block format');
    expect(body).toContain('**▸ paqad**');
  });

  it('reuses the canonical verdict words', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain(PAQAD_VERDICT.pass);
    expect(body).toContain(PAQAD_VERDICT.fail);
    expect(body).toContain(PAQAD_VERDICT.inconclusive);
  });

  it('lists every plain-English term translation from the canonical spec', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain('## Plain-English translations');
    for (const { term, plain } of PAQAD_TERM_TRANSLATIONS) {
      expect(body).toContain(term);
      expect(body).toContain(plain);
    }
  });

  it('stays legible with the status glyphs stripped', () => {
    const stripped = buildNarrationContractBody().replace(/[🟢🔴🟡⚪]/gu, '');
    for (const word of ['good', 'failed', 'needs a look', 'skipped']) {
      expect(stripped).toContain(word);
    }
  });

  it('is a pure builder — repeated calls return identical content', () => {
    expect(buildNarrationContractBody()).toBe(buildNarrationContractBody());
    expect(buildNarrationContractDocument()).toBe(buildNarrationContractDocument());
  });

  it('wraps the body with the managed header in document form', () => {
    const doc = buildNarrationContractDocument();
    expect(doc.startsWith(MANAGED_HEADER)).toBe(true);
    expect(doc).toBe(`${MANAGED_HEADER}\n\n${buildNarrationContractBody()}`);
  });
});
