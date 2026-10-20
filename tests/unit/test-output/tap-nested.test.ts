import { describe, expect, it } from 'vitest';

import { __testOutputInternals } from '@/test-output/service.js';

import { TEST_OUTPUT_FIXTURES } from './fixtures.js';

const VITEST_NESTED = String.raw`TAP version 13
1..3
not ok 1 - broken.test.js
    ---
    error:
        name: "Error"
        message: "Cannot find module './missing-module.js' imported from 'broken.test.js'"
    at: "broken.test.js:1:1"
    ...
not ok 2 - flat.test.js # time=2.71ms {
    1..2
    ok 1 - flat pass # time=0.58ms
    not ok 2 - flat fail # time=1.66ms
        ---
        error:
            name: "Error"
            message: "boom"
        at: "flat.test.js:2:31"
        ...
}
not ok 3 - nested.test.js # time=4.94ms {
    1..2
    not ok 1 - outer suite # time=4.62ms {
        1..2
        ok 1 - passes at the first level # time=0.59ms
        not ok 2 - inner \#group # time=3.79ms {
            1..3
            ok 1 - passes deep # time=0.08ms
            not ok 2 - fails deep # time=3.63ms
                ---
                error:
                    name: "AssertionError"
                    message: "expected 1 to be 2 // Object.is equality"
                at: "nested.test.js:5:40"
                actual: "1"
                expected: "2"
                ...
            ok 3 - is skipped # SKIP
        }
    }
    ok 2 - top-level test outside any describe # time=0.09ms
}
`;

const VITEST_PASSING = String.raw`TAP version 13
1..2
ok 1 - tests/unit/checks/report-target.test.ts # time=93.21ms {
    1..1
    ok 1 - checks report target # time=92.85ms {
        1..3
        ok 1 - activeFeatureDirOrNull # time=85.38ms {
            1..5
            ok 1 - returns null when no feature bundle is active (non-feature-dev / chat) # time=15.84ms
            ok 2 - returns the active bundle dir when one is open # time=14.50ms
            ok 3 - prefers SE_SESSION over CLAUDE_SESSION_ID, so the report lands in A's bundle # time=27.47ms
            ok 4 - skips a blank SE_SESSION and resolves CLAUDE_SESSION_ID # time=13.44ms
            ok 5 - falls back to the cached session when neither variable is set # time=13.78ms
        }
        ok 2 - writeChecksReportForFeature # time=3.13ms {
            1..2
            ok 1 - writes into the bundle when a feature is active, not the global path # time=2.26ms
            ok 2 - writes to the global fallback path when no feature is active # time=0.83ms
        }
        ok 3 - readChecksReportForFeature # time=4.25ms {
            1..4
            ok 1 - reads from the bundle when the active feature carries a report # time=1.67ms
            ok 2 - falls back to the global path when the active bundle carries no report # time=1.48ms
            ok 3 - reads the global path when no feature is active # time=0.84ms
            ok 4 - returns null when nothing is on record anywhere # time=0.21ms
        }
    }
}
ok 2 - tests/unit/cli/checks.test.ts # time=1405.29ms {
    1..1
    ok 1 - paqad-ai checks command # time=1404.88ms {
        1..5
        ok 1 - is registered on the program # time=103.00ms
        ok 2 - exits 0 and persists a green report when every command passes (AC-3) # time=408.50ms
        ok 3 - exits non-zero and persists a red report when a command fails (AC-2) # time=401.47ms
        ok 4 - writes the report into the active feature bundle, not the global path # time=276.11ms
        ok 5 - reports Inconclusive and does not block when no command is mapped # time=215.41ms
    }
}
`;

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

describe('parseTap — nested TAP', () => {
  it('counts vitest leaf tests, not file or suite blocks (AC-3)', () => {
    const { summary, failures } = __testOutputInternals.parseTap(VITEST_NESTED, 'vitest');
    expect(summary).toMatchObject({ total: 8, passed: 4, failed: 3, skipped: 1 });
    expect(failures.map((f) => f.test_id)).toEqual([
      'broken.test.js',
      'flat.test.js > flat fail',
      'nested.test.js > outer suite > inner #group > fails deep',
    ]);
    expect(failures.map((f) => f.suite)).toEqual([
      null,
      'flat.test.js',
      'nested.test.js > outer suite > inner #group',
    ]);
  });

  it('names a failing leaf without the time directive or the block brace', () => {
    const { failures } = __testOutputInternals.parseTap(VITEST_NESTED, 'vitest');
    for (const failure of failures) {
      expect(failure.test_id).not.toMatch(/# time=|\{|\\#/);
    }
  });

  it('counts the AC-3 shape exactly: two passes, one indented failure, one skip', () => {
    const fixture = VITEST_NESTED.slice(
      VITEST_NESTED.indexOf('not ok 3 - nested.test.js'),
      VITEST_NESTED.indexOf('    ok 2 - top-level test'),
    );
    const { summary, failures } = __testOutputInternals.parseTap(fixture, 'vitest');
    expect(summary).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.test_id).toBe('nested.test.js > outer suite > inner #group > fails deep');
  });

  it('counts a passing vitest run by its leaves, matching the default reporter count', () => {
    const { summary, failures } = __testOutputInternals.parseTap(VITEST_PASSING, 'vitest');
    expect(summary).toMatchObject({ total: 16, passed: 16, failed: 0, skipped: 0 });
    expect(failures).toEqual([]);
  });

  it('unescapes a flat TAP name and reads its directive after the first bare #', () => {
    const flat = String.raw`TAP version 13
1..3
not ok 1 - reads C:\\temp \# one # TODO later
ok 2 # skip no name
ok 3 - keeps a trailing hash \#`;
    const { summary, failures } = __testOutputInternals.parseTap(flat, 'tap-runner');
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(failures[0]?.test_id).toBe(String.raw`reads C:\temp # one`);
    expect(failures[0]?.suite).toBeNull();
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
