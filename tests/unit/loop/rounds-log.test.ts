import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH,
  buildRoundsLog,
  writeBuildCheckFixRoundsLog,
} from '@/loop/rounds-log.js';
import {
  BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION,
  type BuildCheckFixOutcome,
} from '@/core/types/build-check-fix.js';

function outcomeFixture(): BuildCheckFixOutcome {
  return {
    status: 'stopped-futility',
    lane: 'graduated',
    max_rounds: 3,
    rounds_used: 2,
    rounds: [
      {
        round_number: 1,
        started_at: 't0',
        completed_at: 't1',
        done: false,
        gates_passed: false,
        blocking_gates: ['code-tests-lint'],
        failing_criteria: ['verification-gates'],
        blocking_findings: [],
        progress_signature: 'ac:verification-gates|gate:code-tests-lint',
        evidence_excerpt: 'boom',
      },
      {
        round_number: 2,
        started_at: 't2',
        completed_at: 't3',
        done: false,
        gates_passed: false,
        blocking_gates: ['code-tests-lint'],
        failing_criteria: ['verification-gates'],
        blocking_findings: [],
        progress_signature: 'ac:verification-gates|gate:code-tests-lint',
        evidence_excerpt: 'boom',
      },
    ],
    stuck_report: {
      reason: 'stopped-futility',
      rounds_used: 2,
      max_rounds: 3,
      blocking_gates: ['code-tests-lint'],
      blocking_criteria: ['verification-gates'],
      blocking_findings: [],
      evidence_excerpt: 'boom',
      decisions_needed: ['Investigate why the code-tests-lint gate keeps failing.'],
    },
  };
}

describe('build-check-fix rounds log', () => {
  it('builds a log that mirrors the loop outcome', () => {
    const log = buildRoundsLog(outcomeFixture(), 't9');
    expect(log.schema_version).toBe(BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION);
    expect(log.lane).toBe('graduated');
    expect(log.status).toBe('stopped-futility');
    expect(log.rounds).toHaveLength(2);
    expect(log.updated_at).toBe('t9');
    expect(log.stuck_report?.reason).toBe('stopped-futility');
  });

  it('persists the internal log atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-rounds-log-'));
    const path = await writeBuildCheckFixRoundsLog(buildRoundsLog(outcomeFixture(), 't9'), {
      project_root: root,
    });

    expect(path).toBe(join(root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH));
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.schema_version).toBe(BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION);
    expect(parsed.rounds).toHaveLength(2);
    expect(parsed.status).toBe('stopped-futility');
  });
});
