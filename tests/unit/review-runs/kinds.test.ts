import { describe, expect, it } from 'vitest';

import { REVIEW_KINDS, reviewStage } from '@/review-runs/kinds.js';

describe('AC-1: the review stage registries', () => {
  it('AC-1: security lists its eight stages and the visible word', () => {
    const security = REVIEW_KINDS.security;
    expect(security.stages.map((stage) => stage.id)).toEqual([
      'scope',
      'map',
      'scan',
      'threats',
      'hunt',
      'confirm',
      'sweep',
      'report',
    ]);
    expect(security.word).toBe('Security review');
    expect(security.route).toBe('pentest');
    expect(security.verb).toBe('security-review');
    expect(security.prefix).toBe('PT-');
  });

  it('AC-1: design lists its eight stages and the visible word', () => {
    const design = REVIEW_KINDS.design;
    expect(design.stages.map((stage) => stage.id)).toEqual([
      'scope',
      'map',
      'code',
      'screens',
      'tasks',
      'judge',
      'confirm',
      'report',
    ]);
    expect(design.word).toBe('Design review');
    expect(design.route).toBe('design-test');
    expect(design.verb).toBe('design-review');
    expect(design.prefix).toBe('DT-');
  });

  it('AC-1: every stage has an index, a label, a full name and a running phrase', () => {
    for (const kind of Object.values(REVIEW_KINDS)) {
      kind.stages.forEach((stage, at) => {
        expect(stage.index).toBe(at + 1);
        expect(stage.label.length).toBeGreaterThan(0);
        expect(stage.name.length).toBeGreaterThan(stage.label.length - 1);
        expect(stage.running.length).toBeGreaterThan(0);
      });
      expect(reviewStage(kind, 'nope')).toBeNull();
      expect(reviewStage(kind, 'scope')?.label).toBe('Scope');
    }
  });
});
