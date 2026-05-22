import { detectDecisionForks } from '@/planning/decision-detector.js';

describe('detectDecisionForks', () => {
  it('detects multiple component nouns as a component-reuse fork', () => {
    expect(detectDecisionForks('Use Card or Tile for the dashboard widget')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'component-reuse',
          signal: 'component-choice',
        }),
      ]),
    );
  });

  it('detects multiple file paths as an architecture-path fork', () => {
    expect(
      detectDecisionForks('Should this live in src/ui/Button.tsx or src/components/Button.tsx?'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'architecture-path',
          signal: 'multiple-file-paths',
        }),
      ]),
    );
  });

  it('returns no forks for a plain feature request', () => {
    expect(detectDecisionForks('Add a dark mode toggle')).toEqual([]);
  });

  it('dedupes repeated signals and covers the default confidence branch', () => {
    const forks = detectDecisionForks(
      'Reuse Button or build new? We could also place it in src/a.ts or src/b.ts.',
    );

    expect(
      forks.filter(
        (fork) => fork.category === 'create-vs-reuse' && fork.signal === 'reuse-vs-create',
      ),
    ).toHaveLength(1);
    expect(forks.find((fork) => fork.signal === 'multiple-file-paths')).toMatchObject({
      confidence: 0.64,
    });
  });
});
