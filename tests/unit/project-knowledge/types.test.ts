import { describe, expect, it } from 'vitest';

import {
  ANSWER_GROUNDING_STATES,
  ANSWER_MODES,
  CITATION_SOURCE_CLASSES,
} from '@/project-knowledge/types.js';

describe('project-knowledge types', () => {
  it('ANSWER_GROUNDING_STATES contains all three states', () => {
    expect(ANSWER_GROUNDING_STATES).toEqual(['observed', 'inferred', 'missing-evidence']);
  });

  it('ANSWER_MODES contains all three modes', () => {
    expect(ANSWER_MODES).toEqual(['quick', 'explain', 'trace']);
  });

  it('CITATION_SOURCE_CLASSES contains all six classes', () => {
    expect(CITATION_SOURCE_CLASSES).toEqual([
      'canonical-doc',
      'generated-instruction',
      'framework-state',
      'manifest',
      'workflow',
      'code',
    ]);
  });

  it('ANSWER_GROUNDING_STATES includes check works for valid values', () => {
    expect(ANSWER_GROUNDING_STATES.includes('observed')).toBe(true);
    expect(ANSWER_GROUNDING_STATES.includes('inferred')).toBe(true);
    expect(ANSWER_GROUNDING_STATES.includes('missing-evidence')).toBe(true);
  });

  it('ANSWER_MODES includes check works for valid values', () => {
    expect(ANSWER_MODES.includes('quick')).toBe(true);
    expect(ANSWER_MODES.includes('explain')).toBe(true);
    expect(ANSWER_MODES.includes('trace')).toBe(true);
  });

  it('CITATION_SOURCE_CLASSES includes check works for valid values', () => {
    expect(CITATION_SOURCE_CLASSES.includes('canonical-doc')).toBe(true);
    expect(CITATION_SOURCE_CLASSES.includes('code')).toBe(true);
  });
});
