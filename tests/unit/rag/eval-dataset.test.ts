import {
  ALL_QUERY_CLASSES,
  EVAL_DATASET,
  getDatasetByClass,
  validateDatasetCoverage,
} from '@/rag/eval-dataset.js';
import type { EvalQueryClass } from '@/rag/types.js';

describe('EvalDataset', () => {
  it('ALL_QUERY_CLASSES contains all 6 required classes', () => {
    expect(ALL_QUERY_CLASSES).toHaveLength(6);
    expect(ALL_QUERY_CLASSES).toContain('simple-lexical');
    expect(ALL_QUERY_CLASSES).toContain('vocabulary-mismatch');
    expect(ALL_QUERY_CLASSES).toContain('ambiguous');
    expect(ALL_QUERY_CLASSES).toContain('multi-part');
    expect(ALL_QUERY_CLASSES).toContain('workflow-triggering');
    expect(ALL_QUERY_CLASSES).toContain('negative');
  });

  it('EVAL_DATASET items all have required fields', () => {
    for (const item of EVAL_DATASET) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.query_class).toBe('string');
      expect(typeof item.task_description).toBe('string');
      expect(Array.isArray(item.keywords)).toBe(true);
    }
  });

  it('EVAL_DATASET has unique IDs', () => {
    const ids = EVAL_DATASET.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('getDatasetByClass', () => {
    it.each(ALL_QUERY_CLASSES as EvalQueryClass[])(
      'returns at least one item for query class "%s"',
      (cls) => {
        const items = getDatasetByClass(cls);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.query_class === cls)).toBe(true);
      },
    );

    it('returns empty array for unknown class', () => {
      const items = getDatasetByClass('unknown' as EvalQueryClass);
      expect(items).toEqual([]);
    });
  });

  it('negative items have should_skip_retrieval set to true', () => {
    const negatives = getDatasetByClass('negative');
    expect(negatives.every((i) => i.should_skip_retrieval === true)).toBe(true);
  });

  it('workflow-triggering items have a workflow_trigger defined', () => {
    const items = getDatasetByClass('workflow-triggering');
    expect(items.every((i) => typeof i.workflow_trigger === 'string')).toBe(true);
  });

  it('validateDatasetCoverage returns true', () => {
    expect(validateDatasetCoverage()).toBe(true);
  });
});
