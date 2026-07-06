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

  it('detects two distinct file paths joined by "or" as a tight explicit-path-fork (0.9)', () => {
    const forks = detectDecisionForks('Put it in src/ui/Button.tsx or src/components/Button.tsx');
    expect(forks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'architecture-path',
          signal: 'explicit-path-fork',
          confidence: 0.9,
        }),
      ]),
    );
  });

  it('detects the "vs" wording for the explicit-path-fork', () => {
    const forks = detectDecisionForks('src/a/handler.ts vs src/b/handler.ts — where should it go?');
    expect(forks.find((fork) => fork.signal === 'explicit-path-fork')).toMatchObject({
      category: 'architecture-path',
      confidence: 0.9,
    });
  });

  it('does NOT raise the tight explicit-path-fork when the same path is repeated', () => {
    const forks = detectDecisionForks('Should src/a.ts or src/a.ts own this?');
    expect(forks.find((fork) => fork.signal === 'explicit-path-fork')).toBeUndefined();
  });

  it('does NOT raise the tight explicit-path-fork on a bare "or" with no two file paths', () => {
    const forks = detectDecisionForks('Add a toggle or a switch to the settings panel');
    expect(forks.find((fork) => fork.signal === 'explicit-path-fork')).toBeUndefined();
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
