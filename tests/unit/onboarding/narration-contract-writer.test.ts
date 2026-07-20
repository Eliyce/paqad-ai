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

  // Issue #409 — the contract used to tell the Claude Code agent that "the entry lines
  // and the end-of-change receipt are surfaced for you", so a compliant agent delegated
  // its voice to a channel Claude Code Desktop never renders. AC-3.
  describe('#409 who speaks, and on which channel', () => {
    it('AC-3: no longer promises that the hooks surface the narration for the agent', () => {
      expect(buildNarrationContractBody()).not.toContain(
        'the entry lines and the end-of-change receipt are surfaced for you',
      );
    });

    it('AC-3: puts the voice on the Claude Code agent itself', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('On **Claude Code** YOU speak');
      expect(body).toContain('Never treat a hook as having spoken for you');
    });

    it('AC-3: states per surface which channels actually render', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('Claude Code CLI');
      expect(body).toContain('Claude Code Desktop');
      expect(body).toContain('recorded as a hook attachment');
      // The channel the agent controls is named as the one that renders.
      expect(body).toContain('Your assistant text, final message of the turn');
    });

    it('states the placement rule mid-turn narration was silently missing', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('**final message of the turn**');
      expect(body).toContain('between tool calls');
    });
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
