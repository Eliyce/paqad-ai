import {
  PAQAD_FRAME_LEAD,
  PAQAD_STATUS_GLYPH,
  PAQAD_STATUS_LABEL,
  PAQAD_TERM_TRANSLATIONS,
  PAQAD_VERDICT,
  paqadFrameLead,
  paqadGlyphLegend,
} from '@/core/constants/paqad-voice.js';

describe('paqad-voice canonical vocabulary', () => {
  it('keeps the four reserved status glyphs stable', () => {
    expect(PAQAD_STATUS_GLYPH).toEqual({
      good: '🟢',
      failed: '🔴',
      needsLook: '🟡',
      skipped: '⚪',
    });
  });

  it('keeps the verdict headlines stable (reused by the PR comment and chat)', () => {
    expect(PAQAD_VERDICT.pass).toBe('Safe to merge');
    expect(PAQAD_VERDICT.fail).toBe('Needs your attention');
    expect(PAQAD_VERDICT.inconclusive).toBe('Inconclusive');
  });

  it('pairs every glyph with a word so lines are legible with glyphs stripped', () => {
    for (const kind of Object.keys(PAQAD_STATUS_GLYPH) as (keyof typeof PAQAD_STATUS_GLYPH)[]) {
      expect(PAQAD_STATUS_LABEL[kind]).toBeTruthy();
    }
  });

  it('renders the glyph legend with each glyph next to its word', () => {
    const legend = paqadGlyphLegend();
    expect(legend).toBe('🟢 good · 🔴 failed · 🟡 needs a look · ⚪ skipped');
    // Stripping the emoji must leave a still-meaningful line.
    const stripped = legend
      .replace(/[🟢🔴🟡⚪]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(stripped).toBe('good · failed · needs a look · skipped');
  });

  it('leads a status block with the stable branded frame', () => {
    expect(paqadFrameLead('routed to full lane')).toBe('**▸ paqad** · routed to full lane');
    expect(PAQAD_FRAME_LEAD).toBe('**▸ paqad**');
  });

  it('translates internal jargon to first-person, on-your-behalf plain language', () => {
    const terms = PAQAD_TERM_TRANSLATIONS.map((t) => t.term);
    for (const expected of [
      'classification',
      'mutation testing',
      'quality ratchet',
      'traceability',
      'decision pause',
    ]) {
      expect(terms).toContain(expected);
    }
    // No raw jargon leaks into the plain phrasing the agent is told to use.
    for (const { plain } of PAQAD_TERM_TRANSLATIONS) {
      expect(plain.toLowerCase()).not.toContain('mutation testing');
      expect(plain.toLowerCase()).not.toContain('quality ratchet');
      expect(plain).toMatch(/\b(I|you|your)\b/);
    }
  });
});
