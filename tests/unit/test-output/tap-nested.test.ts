import { describe, expect, it } from 'vitest';

import { __testOutputInternals } from '@/test-output/service.js';

import { TEST_OUTPUT_FIXTURES } from './fixtures.js';

// Issue #672 — vitest's TAP reporter nests tests under per-file and per-suite entries, indenting
// the leaves; node:test prints subtests before their parent. parseTap counts leaf tests only.

// Real `vitest run --reporter=tap` output (vitest 3): a file block, a suite block, a nested suite
// block with one failing and one skipped leaf, two passing leaves, and a file that failed to load.
const VITEST_NESTED = `TAP version 13
1..2
not ok 1 - a.test.js # time=4.77ms {
    1..2
    not ok 1 - suite one # time=4.50ms {
        1..2
        ok 1 - passes first # time=0.42ms
        not ok 2 - inner # time=3.84ms {
            1..2
            not ok 1 - fails here # time=3.78ms
                ---
                error:
                    name: "AssertionError"
                    message: "expected 1 to be 2 // Object.is equality"
                at: "a.test.js:4:40"
                actual: "1"
                expected: "2"
                ...
            ok 2 - is skipped # SKIP
        }
    }
    ok 2 - top level pass # time=0.04ms
}
not ok 2 - b.test.js
    ---
    error:
        name: "Error"
        message: "Cannot find module './missing-module.js'"
    at: "b.test.js:1:1"
    ...
`;

// Real `node --test --test-reporter=tap` output: subtests print before their parent.
const NODE_TEST_SUBTESTS = `TAP version 13
# Subtest: parent
    # Subtest: child passes
    ok 1 - child passes
      ---
      duration_ms: 0.426208
      type: 'test'
      ...
    # Subtest: child fails
    not ok 2 - child fails
      ---
      duration_ms: 0.579916
      type: 'test'
      failureType: 'testCodeFailure'
      error: '1 == 2'
      ...
    1..2
not ok 1 - parent
  ---
  duration_ms: 1.587583
  type: 'test'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  ...
# Subtest: flat test
ok 2 - flat test
  ---
  duration_ms: 0.053459
  type: 'test'
  ...
# Subtest: skipped one
ok 3 - skipped one # SKIP
  ---
  duration_ms: 0.048833
  type: 'test'
  ...
1..3
# tests 5
`;

describe('parseTap — nested TAP (#672)', () => {
  it('counts vitest leaf tests, not file or suite blocks (AC-3)', () => {
    const { summary, failures } = __testOutputInternals.parseTap(VITEST_NESTED, 'vitest');
    // Leaves: passes first, fails here, is skipped, top level pass, and the file that never loaded.
    expect(summary).toMatchObject({ total: 5, passed: 2, failed: 2, skipped: 1 });
    expect(failures.map((f) => f.test_id)).toEqual(['fails here', 'b.test.js']);
  });

  it('counts the AC-3 shape exactly: two passes, one indented failure, one skip', () => {
    const fixture = VITEST_NESTED.slice(0, VITEST_NESTED.indexOf('not ok 2 - b.test.js'));
    const { summary, failures } = __testOutputInternals.parseTap(fixture, 'vitest');
    expect(summary).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.test_id).toBe('fails here');
  });

  it('counts a passing nested vitest run by its leaves', () => {
    const passing = `TAP version 13
1..1
ok 1 - tests/unit/x.test.ts # time=75.46ms {
    1..1
    ok 1 - suite # time=75.15ms {
        1..2
        ok 1 - first # time=13.94ms
        ok 2 - second # time=11.36ms
    }
}
`;
    expect(__testOutputInternals.parseTap(passing, 'vitest').summary).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
    });
  });

  it('does not count node:test parents alongside their subtests (AC-4)', () => {
    const { summary, failures } = __testOutputInternals.parseTap(NODE_TEST_SUBTESTS, 'node-test');
    expect(summary).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
    expect(failures.map((f) => f.test_id)).toEqual(['child fails']);
  });

  it('keeps the flat TAP count it has today (AC-4)', () => {
    const flat = __testOutputInternals.parseTap(TEST_OUTPUT_FIXTURES.tap.mixed, 'tap-runner');
    expect(flat.summary).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(flat.failures[0]?.message).toBe('math divides\nExpected 4 to equal 5');
    const allPass = __testOutputInternals.parseTap(TEST_OUTPUT_FIXTURES.tap.allPass, 'tap-runner');
    expect(allPass.summary).toMatchObject({ total: 2, passed: 2 });
  });
});
