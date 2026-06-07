import { describe, expect, it } from 'vitest';

import type { MutationResult } from '@/core/types/mutation.js';
import { MutationTestingGate } from '@/verification/gates/mutation-testing.js';

import { createVerificationContext } from '../shared.fixture.js';

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    tool: 'stryker',
    language: 'typescript',
    confidence: 'mature',
    scoped_files: ['src/a.ts'],
    total_mutants: 1,
    killed: 1,
    survived: 0,
    equivalent_set_aside: 0,
    kill_rate: 100,
    surviving_mutants: [],
    tree_clean: true,
    status: 'killed-all',
    skipped_reason: null,
    ...overrides,
  };
}

describe('MutationTestingGate', () => {
  const gate = new MutationTestingGate();

  it('passes (inert) when no mutation result is present', async () => {
    const result = await gate.check(createVerificationContext());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('did not run');
  });

  it('passes when the run was skipped, naming the reason', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({ status: 'skipped', skipped_reason: 'fast-lane' }),
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('fast-lane');
  });

  it('passes when every behaviour-changing mutant was killed', async () => {
    const result = await gate.check(
      createVerificationContext({ mutation_result: mutationResult() }),
    );
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('100%');
  });

  it('escalates (inconclusive) on survivors by default', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({
          status: 'survivors',
          killed: 1,
          survived: 1,
          kill_rate: 50,
          surviving_mutants: [{ file: 'src/a.ts', line: 9, operator: 'ArithmeticOperator' }],
        }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toContain('src/a.ts:9');
  });

  it('hard-fails on survivors when strict mode is enabled', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_strict: true,
        mutation_result: mutationResult({ status: 'survivors', survived: 1, kill_rate: 50 }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBeUndefined();
  });

  it('truncates a long survivor list in the detail', async () => {
    const survivors = Array.from({ length: 7 }, (_, index) => ({
      file: `src/f${index}.ts`,
      line: index,
      operator: 'Op',
    }));
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({
          status: 'survivors',
          survived: 7,
          surviving_mutants: survivors,
        }),
      }),
    );
    expect(result.detail).toContain('+2 more');
  });

  it('marks a lower-confidence result inconclusive even with no survivors', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({
          status: 'lower-confidence',
          confidence: 'lower',
          tool: null,
          language: 'elixir',
        }),
      }),
    );
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toContain('lower-confidence');
  });

  it('hard-fails when the tree was not clean after the run', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({ status: 'unsafe-tree', tree_clean: false }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBeUndefined();
    expect(result.detail).toContain('not clean');
  });

  it('handles a survivor result with a null kill rate', async () => {
    const result = await gate.check(
      createVerificationContext({
        mutation_result: mutationResult({ status: 'survivors', survived: 1, kill_rate: null }),
      }),
    );
    expect(result.detail).toContain('n/a');
  });
});
