import { selectLane, type Complexity, type Risk } from '@/core/types/routing';

describe('selectLane', () => {
  const cases: Array<[Complexity, Risk, string]> = [
    ['trivial', 'low', 'fast'],
    ['trivial', 'medium', 'fast'],
    ['trivial', 'high', 'fast'],
    ['low', 'low', 'fast'],
    ['low', 'medium', 'graduated'],
    ['low', 'high', 'graduated'],
    ['medium', 'low', 'graduated'],
    ['medium', 'medium', 'graduated'],
    ['medium', 'high', 'full'],
    ['high', 'low', 'full'],
    ['high', 'medium', 'full'],
    ['high', 'high', 'full'],
    ['very-high', 'low', 'full'],
    ['very-high', 'medium', 'full'],
    ['very-high', 'high', 'full'],
  ];

  it.each(cases)('maps %s / %s to %s', (complexity, risk, expected) => {
    expect(selectLane(complexity, risk)).toBe(expected);
  });
});
