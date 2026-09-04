import { describe, expect, it } from 'vitest';

import { labelPrompt } from '@/spec-pipeline/labeling.js';
import type { GroundingArtifact } from '@/spec-pipeline/types.js';

const grounding = (over: Partial<GroundingArtifact> = {}): GroundingArtifact => ({
  references: [],
  terms: [],
  sparse: false,
  ...over,
});

describe('labelPrompt', () => {
  it('treats a vague word the docs define as clear/okay, not vague (FR-3-T1)', () => {
    const r = labelPrompt(
      'make the export cleaner',
      grounding({ terms: ['clean export', 'export'] }),
    );
    expect(r.label).not.toBe('vague');
  });

  it('flags concrete nouns that map to nothing real as unclear (FR-3-T2)', () => {
    const r = labelPrompt(
      'wire the flux capacitor to the widget',
      grounding({ terms: ['export', 'invoice'] }),
    );
    expect(r.label).not.toBe('clear');
    expect(r.signals.some((s) => s.kind === 'nothing-concrete')).toBe(true);
  });

  it('is deterministic across repeated runs (FR-3-T3)', () => {
    const prompt = 'maybe make it better somehow';
    const g = grounding({ terms: ['export'] });
    const first = labelPrompt(prompt, g);
    for (let i = 0; i < 50; i += 1) {
      expect(labelPrompt(prompt, g)).toEqual(first);
    }
  });

  it('gives a clear, well-grounded prompt a zero question budget', () => {
    const r = labelPrompt(
      'the export must exclude hidden columns and return within 5 seconds',
      grounding({ terms: ['export', 'hidden columns'] }),
    );
    expect(r.label).toBe('clear');
    expect(r.question_budget).toBe(0);
  });

  it('labels a short, uncertain, ungrounded prompt vague with a full budget', () => {
    const r = labelPrompt('maybe improve stuff', grounding({ terms: [], sparse: true }));
    expect(r.label).toBe('vague');
    expect(r.question_budget).toBeGreaterThan(0);
  });

  it('records the span of every fired signal', () => {
    const r = labelPrompt('maybe better', grounding({ terms: [], sparse: true }));
    expect(r.signals.every((s) => typeof s.span === 'string' && s.span.length > 0)).toBe(true);
  });
});
