import { describe, expect, it } from 'vitest';

import {
  missingTriggerResults,
  queryCorrect,
  scoreTriggerIterations,
  seededRandom,
  splitTriggerQueries,
  triggerGatePasses,
  type TriggerQuery,
} from '@/authoring/eval/split.js';

const QUERIES: TriggerQuery[] = Array.from({ length: 20 }, (_, index) => ({
  id: `q-${String(index + 1).padStart(2, '0')}`,
  query: `query ${index + 1}`,
  should_trigger: index < 10,
}));

describe('the seeded split', () => {
  it('INV-16: pins the 60/40 split of a fixed 20-query set with seed 42', () => {
    const split = splitTriggerQueries(QUERIES);
    const train = split.filter((query) => query.set === 'train').map((query) => query.id);
    expect(train).toHaveLength(12);
    expect(split.filter((query) => query.set === 'train' && query.should_trigger)).toHaveLength(6);
    expect(train).toMatchInlineSnapshot(`
      [
        "q-01",
        "q-02",
        "q-03",
        "q-04",
        "q-06",
        "q-08",
        "q-11",
        "q-12",
        "q-14",
        "q-17",
        "q-19",
        "q-20",
      ]
    `);
    expect(splitTriggerQueries(QUERIES)).toEqual(split);
  });

  it('uses its own generator, never Math.random', () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    expect(seededRandom(7)()).not.toBe(seededRandom(42)());
  });
});

describe('trigger scoring', () => {
  it('AC-53: 2 of 3 fires passes and 1 of 3 fails; a near-miss is right when it fires at most once', () => {
    const positive = QUERIES[0]!;
    const negative = QUERIES[19]!;
    expect(queryCorrect(positive, 2, 2)).toBe(true);
    expect(queryCorrect(positive, 1, 2)).toBe(false);
    expect(queryCorrect(negative, 1, 2)).toBe(true);
    expect(queryCorrect(negative, 2, 2)).toBe(false);
  });

  function allRight(): Array<{ id: string; run: number; fired: boolean }> {
    return QUERIES.flatMap((query) =>
      [1, 2, 3].map((run) => ({ id: query.id, run, fired: query.should_trigger })),
    );
  }

  it('AC-9, AC-52: discards an iteration over 1024 characters and marks the best validation score', () => {
    const split = splitTriggerQueries(QUERIES);
    const validationIds = split
      .filter((query) => query.set === 'validation')
      .map((query) => query.id);
    const oneWrong = allRight().map((result) =>
      result.id === validationIds[0] ? { ...result, fired: !result.fired } : result,
    );
    const scores = scoreTriggerIterations({
      queries: split,
      minRuns: 2,
      iterations: [
        { iteration: 1, description: 'a'.repeat(1024), results: oneWrong },
        { iteration: 2, description: 'b'.repeat(1025), results: allRight() },
        { iteration: 3, description: 'c'.repeat(1023), results: allRight() },
      ],
    });
    expect(
      scores.map((score) => [
        score.iteration,
        score.discarded,
        score.validation_score,
        score.chosen,
      ]),
    ).toEqual([
      [1, false, 0.875, false],
      [2, true, null, false],
      [3, false, 1, true],
    ]);
    expect(scores[1]!.discard_reason).toBe('the description is 1025 characters, over 1024');
    expect(triggerGatePasses(scores[2], 0.9)).toBe(true);
    expect(triggerGatePasses(scores[0], 0.9)).toBe(false);
    expect(triggerGatePasses({ ...scores[0]!, validation_score: 0.9 }, 0.9)).toBe(true);
  });

  it('FR-35: names every missing query id and run', () => {
    const results = allRight().filter((result) => !(result.id === 'q-03' && result.run === 2));
    expect(missingTriggerResults(QUERIES, { iteration: 1, description: 'd', results })).toEqual([
      'q-03 run 2',
    ]);
  });
});

describe('descriptionOverLimit (agent descriptions)', () => {
  it('AC-31: an agent description is limited in tokens, a skill description in characters', async () => {
    const { descriptionOverLimit } = await import('@/authoring/eval/split.js');
    expect(descriptionOverLimit('x'.repeat(1200), 300)).toBeNull();
    expect(descriptionOverLimit('x'.repeat(1204), 300)).toBe(
      'the description is 301 tokens, over 300',
    );
    expect(descriptionOverLimit('x'.repeat(1025))).toMatch(/1025 characters, over 1024/);
  });
});
