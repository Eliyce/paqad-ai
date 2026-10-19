import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StructuredTestResult } from '@/core/types/test-output.js';
import { writeFeatureChecks } from '@/checks/report-store.js';
import { readTraceabilityMap } from '@/traceability/index.js';
import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { AcTestMappingGate } from '@/verification/gates/ac-test-mapping.js';

import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';
import {
  openChange,
  writeSpec,
  type CriterionSeed,
} from '../../traceability/change-map.fixture.js';

// Issue #639, Part 11 — the Stop verification builds the change's acceptance-criteria map
// itself and the `ac-test-mapping` gate reads it honestly.

const roots: string[] = [];
let priorSession: string | undefined;

beforeEach(() => {
  priorSession = process.env.CLAUDE_SESSION_ID;
});

afterEach(() => {
  if (priorSession === undefined) delete process.env.CLAUDE_SESSION_ID;
  else process.env.CLAUDE_SESSION_ID = priorSession;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface ChangeSetup {
  session: string;
  files: Record<string, string>;
  criteria?: CriterionSeed[];
  lane?: 'fast' | 'graduated' | 'full';
  title?: string;
}

/** A git repo whose changed files are `files`, with an open change and (optionally) a frozen spec. */
function change(setup: ChangeSetup): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ac-stop-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  for (const [rel, body] of Object.entries(setup.files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  seedGitChangedFiles(root, Object.keys(setup.files));
  const dir = openChange(root, setup.session, setup.lane ?? 'full', setup.title);
  if (setup.criteria) writeSpec(root, dir, setup.criteria);
  process.env.CLAUDE_SESSION_ID = setup.session;
  return { root, dir };
}

function failing(testId: string): StructuredTestResult {
  return {
    schema_version: '1.0.0',
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      errored: 0,
      duration_ms: 1,
      timestamp: '1970-01-01T00:00:00.000Z',
      runner_id: 'test',
    },
    failures: [
      {
        test_id: testId,
        suite: null,
        message: 'expected true',
        stack_trace: null,
        file_path: 'tests/feature.test.ts',
        line_number: 1,
        category: 'assertion',
        duration_ms: 1,
      },
    ],
    errors: [],
    warnings: [],
    parse_metadata: {
      raw_byte_size: 1,
      structured_byte_size: 1,
      compression_ratio: 0,
      original_size: 1,
      compact_size: 1,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
  };
}

describe('ac-test-mapping at Stop verification (#639 Part 11)', () => {
  it('AC-32: the ORD-490 fast-lane change with no frozen spec reads not required', async () => {
    const { root } = change({
      session: 'ses-490',
      files: { 'src/copy.ts': 'export const copy = "Save";\n' },
      lane: 'fast',
      title: 'ORD-490 copy fix',
    });

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    const result = await new AcTestMappingGate().check(context);

    expect(context.ac_test_mapping_outcome).toBe('not-required');
    expect(result).toEqual({
      gate: 'ac-test-mapping',
      passed: true,
      outcome: 'not-required',
      detail: 'No frozen spec, so no acceptance criteria to map.',
    });
    expect(await readTraceabilityMap(root)).toBeNull();
  });

  it('AC-33: an automated criterion with no proving test fails at Stop naming the id', async () => {
    const { root } = change({
      session: 'ses-33',
      files: {
        'src/export.ts': 'export const rows = 1;\n',
        'tests/export.test.ts': "it('AC-1 exports the rows', () => {});\n",
      },
      criteria: [
        { id: 'AC-1', proof: 'automated' },
        { id: 'AC-2', proof: 'automated' },
      ],
    });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
    });

    const acGate = verdict.gates.find((gate) => gate.gate === 'ac-test-mapping');
    expect(acGate?.status).toBe('fail');
    expect(acGate?.detail).toBe(
      'Automated acceptance criteria with no proving test changed on this branch: AC-2.',
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('AC-2');
  });

  it('AC-31: visual and manual criteria are not reported missing at Stop', async () => {
    const { root } = change({
      session: 'ses-31',
      files: { 'src/page.tsx': 'export const Page = () => null;\n' },
      criteria: [
        { id: 'AC-1', proof: 'visual' },
        { id: 'AC-2', proof: 'manual' },
      ],
    });

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    const result = await new AcTestMappingGate().check(context);

    expect(result.outcome).toBe('not-required');
    expect(result.detail).toContain('visual: AC-1');
    expect(result.detail).toContain('manual: AC-2');
    expect(result.detail).not.toMatch(/no proving test/);
  });

  it('AC-35: a criterion whose only tagged test failed in the recorded checks is not proved and the gate fails naming it', async () => {
    const { root, dir } = change({
      session: 'ses-35',
      files: {
        'src/export.ts': 'export const rows = 1;\n',
        'tests/feature.test.ts': "it('AC-1 exports', () => {});\nit('AC-2 holds', () => {});\n",
      },
      criteria: [
        { id: 'AC-1', proof: 'automated' },
        { id: 'AC-2', proof: 'automated' },
      ],
    });
    writeFeatureChecks(root, dir, {
      schema_version: 1,
      passed: false,
      ran: true,
      results: [failing('feature > AC-1 exports')],
    });

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    const result = await new AcTestMappingGate().check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toBe(
      'Automated acceptance criteria with no proving test changed on this branch: AC-1.',
    );
  });

  it('AC-36: Stop builds and writes the map before the gate reads it, with no checks run', async () => {
    const { root, dir } = change({
      session: 'ses-36',
      files: {
        'src/export.ts': 'export const rows = 1;\n',
        'tests/export.test.ts':
          "describe('AC-1 export', () => {});\n// @obligation AC-2\nit('writes', () => {});\n",
      },
      criteria: [
        { id: 'AC-1', proof: 'automated' },
        { id: 'AC-2', proof: 'automated' },
      ],
    });
    expect(await readTraceabilityMap(root)).toBeNull();

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    const onDisk = await readTraceabilityMap(root);
    expect(onDisk).toMatchObject({ scope: 'change', change: dir, lane: 'full' });
    expect(onDisk?.forward.map((link) => [link.promise_id, link.proven])).toEqual([
      ['AC-1', true],
      ['AC-2', true],
    ]);
    // AC-34: a full map passes keeping its computed detail.
    const result = await new AcTestMappingGate().check(context);
    expect(result).toEqual({
      gate: 'ac-test-mapping',
      passed: true,
      detail: 'All 2 automated acceptance criteria map to a proving test.',
    });
  });

  it('ignores a change map an earlier change left on disk when this change has no frozen spec', async () => {
    const { root } = change({
      session: 'ses-stale',
      files: { 'src/copy.ts': 'export const copy = 1;\n' },
      lane: 'fast',
      title: 'ORD-490 copy fix',
    });
    mkdirSync(join(root, '.paqad/traceability'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/traceability/map.json'),
      JSON.stringify({
        schema_version: '1.0.0',
        generated_at: '2026-01-01T00:00:00.000Z',
        lane: 'full',
        mode: 'full',
        anchors_known: true,
        blocked_reason: null,
        scope: 'change',
        change: 'an-earlier-change',
        forward: [
          {
            promise_id: 'AC-1',
            source: 'acceptance-criterion',
            description: 'old',
            delivering_code: ['src/old/a.ts'],
            proving_checks: [],
            proven: false,
          },
        ],
        backward: [],
        findings: [],
        counts: {
          promises: 1,
          untested_promises: 1,
          delivers_promise: 1,
          shared_groundwork: 0,
          orphan_code: 0,
        },
      }),
    );

    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.ac_test_mapping_outcome).toBe('not-required');
    // The stale map neither claims a frozen spec nor draws a scope boundary.
    expect(escalations.join('\n')).toContain('spec-review');
    expect(context.spec_boundary).toBeUndefined();
  });
});
