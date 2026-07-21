import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  anchoringFindings,
  collectMachineFindings,
  findingAnchor,
  unanchoredMachineFindings,
  type MachineFinding,
} from '@/review-digest/index.js';

// Issue #360 — the collector is the single source of the machine-finding rows for BOTH
// the digest the model reads and the gate that checks the model addressed them, so it is
// tested against fixtures for all four cached sources plus every absent/corrupt path.
describe('collectMachineFindings', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-digest-sources-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(relative: string, body: unknown): void {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(body), 'utf8');
  }

  it('returns nothing when no source has been recorded', () => {
    expect(collectMachineFindings(root)).toEqual([]);
  });

  it('returns nothing when every source is unparseable, and never throws', () => {
    for (const relative of [
      PATHS.RULE_SCRIPTS_REPORT,
      PATHS.DUPLICATION_REPORT,
      PATHS.CHECKS_REPORT,
      '.paqad/session/verification-evidence.json',
    ]) {
      const target = join(root, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '{not json', 'utf8');
    }
    expect(collectMachineFindings(root)).toEqual([]);
  });

  it('flattens rule-script findings, carrying their severity and tier through', () => {
    write(PATHS.RULE_SCRIPTS_REPORT, {
      results: [
        {
          rule_id: 'RL-6740',
          script: 'a.mjs',
          kind: 'deterministic',
          findings: [
            { file: 'src/x.ts', line: 12, message: 'docs   disagree\nwith code', severity: 'high' },
          ],
        },
        {
          rule_id: 'RL-0001',
          script: 'b.mjs',
          kind: 'heuristic',
          findings: [{ file: 'src/y.ts', message: 'maybe', severity: 'low' }],
        },
      ],
    });

    expect(collectMachineFindings(root)).toEqual([
      {
        source: 'rule:RL-6740',
        severity: 'high',
        tier: 'deterministic',
        file: 'src/x.ts',
        line: '12',
        message: 'docs disagree with code',
      },
      {
        source: 'rule:RL-0001',
        severity: 'low',
        tier: 'heuristic',
        file: 'src/y.ts',
        line: null,
        message: 'maybe',
      },
    ]);
  });

  it('maps the duplication bands onto severity: deterministic is high, heuristic is medium', () => {
    write(PATHS.DUPLICATION_REPORT, {
      schema_version: 1,
      findings: [
        {
          file: 'src/new.ts',
          line_range: { start: 10, end: 40 },
          matched_file: 'src/old.ts',
          matched_line_range: { start: 1, end: 31 },
          similarity: 0.94,
          matched_callers: 3,
          corroborated: false,
          kind: 'deterministic',
          message: 'near-copy of an existing helper',
        },
        {
          file: 'src/other.ts',
          line_range: { start: 5, end: 5 },
          matched_file: 'src/old.ts',
          matched_line_range: { start: 2, end: 2 },
          similarity: 0.82,
          matched_callers: 0,
          corroborated: false,
          kind: 'heuristic',
          message: 'loosely similar',
        },
      ],
    });

    expect(collectMachineFindings(root)).toMatchObject([
      { source: 'duplication', severity: 'high', tier: 'deterministic', line: '10-40' },
      { source: 'duplication', severity: 'medium', tier: 'heuristic', line: '5' },
    ]);
  });

  it('summarises each check command and itemises its failures', () => {
    write(PATHS.CHECKS_REPORT, {
      schema_version: 1,
      generated_at: '2026-07-21T00:00:00.000Z',
      passed: false,
      ran: true,
      results: [
        {
          summary: { total: 3, passed: 3, failed: 0, skipped: 0, errored: 0, runner_id: 'format' },
          failures: [],
        },
        {
          summary: { total: 9, passed: 7, failed: 1, skipped: 0, errored: 1, runner_id: 'test' },
          failures: [
            {
              test_id: 'digest > caps output',
              message: 'expected 150',
              file_path: 'tests/a.test.ts',
              line_number: 42,
            },
            {
              test_id: 'digest > builds',
              message: 'threw',
              file_path: 'tests/b.test.ts',
              line_number: null,
            },
          ],
        },
      ],
    });

    expect(collectMachineFindings(root)).toEqual([
      {
        source: 'checks',
        severity: 'info',
        tier: 'deterministic',
        file: null,
        line: null,
        message: 'format: 3 passing of 3',
      },
      {
        source: 'checks',
        severity: 'high',
        tier: 'deterministic',
        file: null,
        line: null,
        message: 'test: 2 failing of 9',
      },
      {
        source: 'checks:test',
        severity: 'high',
        tier: 'deterministic',
        file: 'tests/a.test.ts',
        line: '42',
        message: 'digest > caps output: expected 150',
      },
      {
        source: 'checks:test',
        severity: 'high',
        tier: 'deterministic',
        file: 'tests/b.test.ts',
        line: null,
        message: 'digest > builds: threw',
      },
    ]);
  });

  it('flattens failing and inconclusive gates, and keeps a gate that itemised nothing', () => {
    write('.paqad/session/verification-evidence.json', {
      gates: [
        { name: 'change-completeness', status: 'pass', detail: 'fine', failures: [] },
        { name: 'spec-review', status: 'fail', detail: 'critical defect open', failures: [] },
        {
          name: 'ac-test-mapping',
          status: 'inconclusive',
          detail: 'cannot tell',
          failures: [
            {
              category: 'gate-failure',
              file: 'src/z.ts',
              line: 7,
              ac_id: 'AC-2',
              message: 'unmapped',
            },
            { category: 'gate-failure', file: null, line: null, ac_id: null, message: 'no anchor' },
          ],
        },
      ],
    });

    expect(collectMachineFindings(root)).toEqual([
      {
        source: 'gate:spec-review',
        severity: 'high',
        tier: 'deterministic',
        file: null,
        line: null,
        message: 'critical defect open',
      },
      {
        source: 'gate:ac-test-mapping',
        severity: 'medium',
        tier: 'deterministic',
        file: 'src/z.ts',
        line: '7',
        message: 'AC-2: unmapped',
      },
      {
        source: 'gate:ac-test-mapping',
        severity: 'medium',
        tier: 'deterministic',
        file: null,
        line: null,
        message: 'no anchor',
      },
    ]);
  });

  it('clips an overlong message rather than letting one row swamp the digest', () => {
    write(PATHS.RULE_SCRIPTS_REPORT, {
      results: [
        {
          rule_id: 'RL-long',
          script: 'a.mjs',
          kind: 'deterministic',
          findings: [{ file: 'src/x.ts', line: 1, message: 'x'.repeat(500), severity: 'high' }],
        },
      ],
    });
    const [row] = collectMachineFindings(root);
    expect(row.message).toHaveLength(200);
    expect(row.message.endsWith('…')).toBe(true);
  });
});

describe('anchoring', () => {
  const row = (over: Partial<MachineFinding> = {}): MachineFinding => ({
    source: 'rule:RL-1',
    severity: 'high',
    tier: 'deterministic',
    file: 'src/x.ts',
    line: '12',
    message: 'm',
    ...over,
  });

  it('renders an anchor as file:line, bare file, or null', () => {
    expect(findingAnchor(row())).toBe('src/x.ts:12');
    expect(findingAnchor(row({ line: null }))).toBe('src/x.ts');
    expect(findingAnchor(row({ file: null }))).toBeNull();
  });

  it('only deterministic, file-anchored, high-band rows are ever review-blocking', () => {
    const findings = [
      row(),
      row({ severity: 'critical' }),
      row({ severity: 'blocker' }),
      row({ severity: 'medium' }),
      row({ tier: 'heuristic' }),
      row({ file: null }),
    ];
    expect(anchoringFindings(findings).map((f) => f.severity)).toEqual([
      'high',
      'critical',
      'blocker',
    ]);
  });

  it('treats a row as addressed only when its file:line appears in the review text', () => {
    const findings = [row(), row({ file: 'src/y.ts', line: '3' })];
    expect(unanchoredMachineFindings(findings, 'I looked at src/x.ts:12 and it is fine')).toEqual([
      findings[1],
    ]);
    expect(unanchoredMachineFindings(findings, '')).toEqual(findings);
    expect(unanchoredMachineFindings(findings, 'src/x.ts:12 and src/y.ts:3 both checked')).toEqual(
      [],
    );
  });
});
