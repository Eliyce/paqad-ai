import { PreClassifier } from '@/pipeline/pre-classifier.js';

describe('PreClassifier decision fork detection', () => {
  it('detects create-vs-reuse forks before execution', async () => {
    const result = await new PreClassifier().classify({
      request: 'Add a primary action, reuse Button or build new?',
    });

    expect(result.resolved.decision_category).toBe('create-vs-reuse');
    expect(result.detected_forks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'create-vs-reuse',
          signal: 'reuse-vs-create',
        }),
      ]),
    );
    expect(result.evidence).toContain('decision-fork:create-vs-reuse:reuse-vs-create');
  });
});
