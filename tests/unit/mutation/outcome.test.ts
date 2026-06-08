import { describe, expect, it } from 'vitest';

import type { RawMutant } from '@/core/types/mutation.js';
import { computeMutationOutcome } from '@/mutation/outcome.js';

function mutant(overrides: Partial<RawMutant> = {}): RawMutant {
  return {
    file: 'src/a.ts',
    line: 1,
    operator: 'ConditionalExpression',
    status: 'killed',
    ...overrides,
  };
}

describe('computeMutationOutcome', () => {
  it('counts killed (incl. timeout) and reaches killed-all when nothing survives', () => {
    const result = computeMutationOutcome({
      mutants: [mutant({ status: 'killed' }), mutant({ status: 'timeout', line: 2 })],
      confidence: 'mature',
      tree_clean: true,
      scoped_files: ['src/a.ts'],
      tool: 'stryker',
      language: 'typescript',
    });
    expect(result.killed).toBe(2);
    expect(result.survived).toBe(0);
    expect(result.kill_rate).toBe(100);
    expect(result.status).toBe('killed-all');
    expect(result.surviving_mutants).toEqual([]);
  });

  it('lists survivors (incl. no-coverage) by file/line/operator and computes the rate', () => {
    const result = computeMutationOutcome({
      mutants: [
        mutant({ status: 'killed' }),
        mutant({
          status: 'survived',
          file: 'src/b.ts',
          line: 9,
          operator: 'ArithmeticOperator',
          description: '+ → -',
        }),
        mutant({ status: 'no-coverage', file: 'src/a.ts', line: 4, operator: 'BooleanLiteral' }),
      ],
      confidence: 'mature',
      tree_clean: true,
      scoped_files: ['src/b.ts', 'src/a.ts'],
      tool: 'stryker',
      language: 'typescript',
    });
    expect(result.survived).toBe(2);
    expect(result.kill_rate).toBe(33.33);
    expect(result.status).toBe('survivors');
    expect(result.scoped_files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.surviving_mutants).toEqual([
      { file: 'src/a.ts', line: 4, operator: 'BooleanLiteral' },
      { file: 'src/b.ts', line: 9, operator: 'ArithmeticOperator', description: '+ → -' },
    ]);
  });

  it('sets equivalent and errored mutants aside and excludes them from the denominator', () => {
    const result = computeMutationOutcome({
      mutants: [
        mutant({ status: 'killed' }),
        mutant({ status: 'equivalent', line: 2 }),
        mutant({ status: 'error', line: 3 }),
      ],
      confidence: 'mature',
      tree_clean: true,
      scoped_files: ['src/a.ts'],
      tool: 'stryker',
      language: 'typescript',
    });
    expect(result.equivalent_set_aside).toBe(2);
    expect(result.kill_rate).toBe(100);
    expect(result.status).toBe('killed-all');
  });

  it('reports a null kill rate when there are no eligible mutants', () => {
    const result = computeMutationOutcome({
      mutants: [mutant({ status: 'equivalent' })],
      confidence: 'mature',
      tree_clean: true,
      scoped_files: [],
      tool: 'stryker',
      language: 'typescript',
    });
    expect(result.kill_rate).toBeNull();
    expect(result.status).toBe('killed-all');
  });

  it('flags lower-confidence even when everything was killed', () => {
    const result = computeMutationOutcome({
      mutants: [mutant({ status: 'killed' })],
      confidence: 'lower',
      tree_clean: true,
      scoped_files: ['src/a.ex'],
      tool: 'generic',
      language: 'elixir',
    });
    expect(result.status).toBe('lower-confidence');
  });

  it('hard-flags an unsafe tree regardless of survivors or confidence', () => {
    const result = computeMutationOutcome({
      mutants: [mutant({ status: 'killed' })],
      confidence: 'mature',
      tree_clean: false,
      scoped_files: ['src/a.ts'],
      tool: 'stryker',
      language: 'typescript',
    });
    expect(result.status).toBe('unsafe-tree');
    expect(result.tree_clean).toBe(false);
  });
});
