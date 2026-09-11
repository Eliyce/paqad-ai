import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { confirmFailures } from '@/checks/isolation-rerun.js';
import type { SingleRunOutcome } from '@/checks/isolation-rerun.js';
import { TEST_OUTPUT_SCHEMA_VERSION } from '@/core/types/test-output.js';
import type { StructuredTestIssue, StructuredTestResult } from '@/core/types/test-output.js';

function issue(name: string, file = `tests/${name}.test.ts`): StructuredTestIssue {
  return {
    test_id: name,
    suite: 'Suite',
    message: `${name} failed`,
    stack_trace: null,
    file_path: file,
    line_number: 42,
    category: 'assertion',
    duration_ms: 1,
  };
}

function result(failures: StructuredTestIssue[], total: number): StructuredTestResult {
  return {
    schema_version: TEST_OUTPUT_SCHEMA_VERSION,
    summary: {
      total,
      passed: total - failures.length,
      failed: failures.length,
      skipped: 0,
      errored: 0,
      duration_ms: 10,
      timestamp: '2026-01-01T00:00:00.000Z',
      runner_id: 'vitest',
    },
    failures,
    warnings: [],
    parse_metadata: {
      raw_byte_size: 0,
      structured_byte_size: 0,
      compression_ratio: 1,
      original_size: 0,
      compact_size: 0,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: {},
  };
}

/** A run outcome for a single parsed test: pass (1 passing test) or fail (1 failing test). */
function outcome(pass: boolean, total = 1): SingleRunOutcome {
  return {
    exitCode: pass ? 0 : 1,
    result: {
      ...result([], total),
      summary: {
        ...result([], total).summary,
        total,
        passed: pass ? total : 0,
        failed: pass ? 0 : total,
      },
    },
  };
}

describe('confirmFailures', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-isolation-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const NOW = () => '2026-09-11T10:00:00.000Z';

  // Map test_id -> whether every isolated re-run passes.
  function runSingleFor(passIds: Set<string>) {
    return async (command: string): Promise<SingleRunOutcome> => {
      const passes = [...passIds].some((id) => command.includes(id));
      return outcome(passes);
    };
  }

  it('sets aside pass-alone tests and blocks fails-alone under warn (AC-6)', async () => {
    const failures = ['a', 'b', 'c', 'd', 'e'].map((n) => issue(n));
    const out = await confirmFailures({
      result: result(failures, 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle: runSingleFor(new Set(['d', 'e'])),
    });

    expect(out.result.summary.failed).toBe(3);
    expect(out.flaky_under_parallel).toHaveLength(2);
    expect(out.meaningful_green).toBe(false);
    expect(out.result.warnings.filter((w) => w.type === 'flaky-under-parallel')).toHaveLength(2);

    const registry = JSON.parse(readFileSync(join(root, '.paqad/flaky-tests/registry.json'), 'utf8'));
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries[0].first_seen).toBeDefined();

    const recovered = out.isolation_reruns.entries.filter((e) => e.verdict === 'recovered');
    expect(recovered.every((e) => e.blocking === false)).toBe(true);
    expect(out.isolation_reruns.entries.filter((e) => e.verdict === 'real')).toHaveLength(3);
  });

  it('under fail keeps recovered tests blocking (AC-6)', async () => {
    const failures = ['a', 'b', 'c', 'd', 'e'].map((n) => issue(n));
    const out = await confirmFailures({
      result: result(failures, 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'fail',
      rerunCount: 3,
      now: NOW,
      runSingle: runSingleFor(new Set(['d', 'e'])),
    });
    expect(out.result.summary.failed).toBe(5);
    expect(out.isolation_reruns.entries.filter((e) => e.verdict === 'recovered' && e.blocking)).toHaveLength(2);
  });

  it('skips the re-runs above the caps (AC-7)', async () => {
    let calls = 0;
    const runSingle = async (): Promise<SingleRunOutcome> => {
      calls += 1;
      return outcome(true);
    };
    // 11 of 100 → over absolute cap
    const many = Array.from({ length: 11 }, (_, i) => issue(`t${i}`));
    const over = await confirmFailures({
      result: result(many, 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle,
    });
    expect(over.isolation_reruns.skipped_reason).toBe('too-many-failures');
    expect(calls).toBe(0);

    // 3 of 40 (7.5%) → over ratio
    const ratio = await confirmFailures({
      result: result(Array.from({ length: 3 }, (_, i) => issue(`r${i}`)), 40),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle,
    });
    expect(ratio.isolation_reruns.skipped_reason).toBe('too-many-failures');

    // 2 of 100 → re-runs performed
    const ok = await confirmFailures({
      result: result([issue('x'), issue('y')], 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle,
    });
    expect(ok.isolation_reruns.performed).toBe(true);
    expect(calls).toBeGreaterThan(0);
  });

  it('is conservative about selectors and flip verdicts (AC-8)', async () => {
    // no file_path under the file selector → no-selector, blocking, not re-run
    const noFile: StructuredTestIssue = { ...issue('nf'), file_path: null };
    const noSelector = await confirmFailures({
      result: result([noFile], 100),
      projectRoot: root,
      singleCommandTemplate: 'run <path_or_file>',
      singleSelector: 'file',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle: async () => outcome(true),
    });
    expect(noSelector.isolation_reruns.entries[0]!.reason).toBe('no-selector');
    expect(noSelector.isolation_reruns.entries[0]!.blocking).toBe(true);

    // parsed total === 0 on every re-run → selector-matched-nothing, blocking
    const matchedNothing = await confirmFailures({
      result: result([issue('mn')], 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle: async () => outcome(false, 0),
    });
    expect(matchedNothing.isolation_reruns.entries[0]!.reason).toBe('selector-matched-nothing');
    expect(matchedNothing.isolation_reruns.entries[0]!.blocking).toBe(true);

    // fails 1 of 3 isolated runs → flaky, blocking
    let n = 0;
    const flaky = await confirmFailures({
      result: result([issue('fk')], 100),
      projectRoot: root,
      singleCommandTemplate: 'run <pattern>',
      singleSelector: 'test_id',
      flakyMode: 'warn',
      rerunCount: 3,
      now: NOW,
      runSingle: async () => outcome(n++ !== 0),
    });
    expect(flaky.isolation_reruns.entries[0]!.verdict).toBe('flaky');
    expect(flaky.isolation_reruns.entries[0]!.blocking).toBe(true);
  });
});
