import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import { REPORT_REPAIR_REASON } from '@/stage-evidence/report-repair.js';
import { backfillStageReports, readLastReport } from '@/stage-isolation/report-backfill.js';
import { buildStageReport } from '@/stage-isolation/stage-handback.js';

const SESSION = 'ses_backfill';
const WITH_REPORT = 'with-report-01HW000000000000000000000A';
const NO_TRANSCRIPT = 'no-transcript-01HW000000000000000000000B';
const NO_STATUS = 'no-status-01HW000000000000000000000C';
const CLEAN = 'clean-01HW000000000000000000000D';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function handback(message: string): string {
  return JSON.stringify({
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }],
    },
  });
}

function seedChange(root: string, dir: string, agentId: string, stated = false): void {
  mkdirSync(join(root, featureFilePath(dir, 'stageEvidence'), '..'), { recursive: true });
  appendFeatureStageRow(root, SESSION, dir, { kind: 'stage_start', stage: 'review' });
  appendFeatureStageRow(root, SESSION, dir, {
    kind: 'stage-agent',
    stage: 'review',
    agent: 'paqad-review',
    agent_id: agentId,
    event_status: 'completed',
    report_status: stated ? 'DONE' : 'BLOCKED',
    report_stated: stated,
    report_source: stated ? 'text' : 'none',
    advance: stated,
    tokens_used: 0,
    tokens_not_recarried: 0,
    estimate: false,
  });
}

function fixture(): { root: string; findTranscript: (agentId: string) => string | null } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-backfill-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  seedChange(root, WITH_REPORT, 'agent_report');
  seedChange(root, NO_TRANSCRIPT, 'agent_gone');
  seedChange(root, NO_STATUS, 'agent_silent');
  seedChange(root, CLEAN, 'agent_clean', true);
  const reported = join(root, 'reported.jsonl');
  const silent = join(root, 'silent.jsonl');
  writeFileSync(reported, `${handback('All done.\n\nStatus: DONE_WITH_CONCERNS')}\n`);
  writeFileSync(silent, `${handback('I stopped part way.')}\n`);
  const paths: Record<string, string> = { agent_report: reported, agent_silent: silent };
  return { root, findTranscript: (agentId) => paths[agentId] ?? null };
}

function ledgers(root: string): Record<string, string> {
  return Object.fromEntries(
    [WITH_REPORT, NO_TRANSCRIPT, NO_STATUS, CLEAN].map((dir) => [
      dir,
      readFileSync(join(root, featureFilePath(dir, 'stageEvidence')), 'utf8'),
    ]),
  );
}

function repairs(root: string, dir: string) {
  return readFeatureStageUnit(root, dir).filter((row) => row.kind === 'record-repair');
}

function fold(root: string, dir: string) {
  return foldRowsWithKey(readFeatureStageUnit(root, dir), {
    sessionId: SESSION,
    changeKey: dir,
    promptOrdinal: 1,
  });
}

describe('the stage report backfill', () => {
  const run = (root: string, findTranscript: (agentId: string) => string | null) =>
    backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2020-01-01',
      findTranscript,
      apply: true,
    });

  it('AC-45: run twice, it writes one row per change and changes no existing row', () => {
    const { root, findTranscript } = fixture();
    const before = ledgers(root);
    expect(
      run(root, findTranscript)
        .map((change) => change.dirName)
        .sort(),
    ).toEqual([NO_STATUS, NO_TRANSCRIPT, WITH_REPORT]);
    const after = ledgers(root);
    for (const dir of [WITH_REPORT, NO_TRANSCRIPT, NO_STATUS]) {
      expect(after[dir]!.startsWith(before[dir]!)).toBe(true);
      expect(repairs(root, dir)).toHaveLength(1);
      expect(repairs(root, dir)[0]?.reason).toBe(REPORT_REPAIR_REASON);
    }
    expect(after[CLEAN]).toBe(before[CLEAN]);
    expect(run(root, findTranscript)).toEqual([]);
    expect(ledgers(root)).toEqual(after);
  });

  it('AC-45: the fold and the stage report show the repaired status', () => {
    const { root, findTranscript } = fixture();
    expect(fold(root, WITH_REPORT).repaired_reports).toBeUndefined();
    run(root, findTranscript);
    expect(fold(root, WITH_REPORT).repaired_reports).toEqual([
      {
        agent_id: 'agent_report',
        stages: ['review'],
        report_status: 'DONE_WITH_CONCERNS',
        source: 'handback',
      },
    ]);
    const report = buildStageReport(readFeatureStageUnit(root, WITH_REPORT), 'agent_report');
    expect(report).toMatchObject({
      report_status: 'DONE_WITH_CONCERNS',
      report_source: 'handback',
      reason: REPORT_REPAIR_REASON,
    });
  });

  it('AC-45: a change with no handback to read gets no invented status', () => {
    const { root, findTranscript } = fixture();
    run(root, findTranscript);
    for (const [dir, agentId] of [
      [NO_TRANSCRIPT, 'agent_gone'],
      [NO_STATUS, 'agent_silent'],
    ] as const) {
      expect(fold(root, dir).repaired_reports).toBeUndefined();
      const report = buildStageReport(readFeatureStageUnit(root, dir), agentId);
      expect(report?.report_status).toBe('BLOCKED');
      expect(report?.report_source).toBe('none');
    }
    expect(repairs(root, NO_TRANSCRIPT)[0]?.note).toContain('no transcript found');
    expect(repairs(root, NO_STATUS)[0]?.note).toContain('no Status line');
  });

  it('reads a real row from before the structured note the same way', () => {
    const { root } = fixture();
    appendFeatureStageRow(root, SESSION, WITH_REPORT, {
      kind: 'record-repair',
      reason: REPORT_REPAIR_REASON,
      note: 'agent_report planning+review: BLOCKED (handback); other development: no transcript found',
    });
    expect(fold(root, WITH_REPORT).repaired_reports).toEqual([
      {
        agent_id: 'agent_report',
        stages: ['planning', 'review'],
        report_status: 'BLOCKED',
        source: 'handback',
      },
    ]);
  });

  it('AC-45: a repair row reaches the stage report for an old row with no report source', () => {
    const rows = [
      { kind: 'stage_start', stage: 'checks', agent_id: 'old_agent' },
      {
        kind: 'stage-agent',
        stage: 'checks',
        agent: 'paqad:paqad-checks',
        agent_id: 'old_agent',
        event_status: 'completed',
        report_status: 'BLOCKED',
        report_stated: false,
      },
      {
        kind: 'record-repair',
        reason: REPORT_REPAIR_REASON,
        note: 'other planning: DONE (handback); old_agent checks: DONE_WITH_CONCERNS (handback)',
      },
    ];
    expect(buildStageReport(rows, 'old_agent')).toMatchObject({
      report_status: 'DONE_WITH_CONCERNS',
      report_source: 'handback',
      reason: REPORT_REPAIR_REASON,
    });
    expect(buildStageReport(rows.slice(0, 2), 'old_agent')).toMatchObject({
      report_status: 'UNKNOWN',
      report_source: 'legacy',
    });
  });

  it('writes nothing on a dry run', () => {
    const { root, findTranscript } = fixture();
    const before = ledgers(root);
    const changes = backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2020-01-01',
      findTranscript,
    });
    expect(changes).toHaveLength(3);
    expect(changes.every((change) => !change.written)).toBe(true);
    expect(ledgers(root)).toEqual(before);
  });

  it('leaves a change from before the cut-off alone', () => {
    const { root, findTranscript } = fixture();
    const changes = backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2999-01-01',
      findTranscript,
      apply: true,
    });
    expect(changes).toEqual([]);
  });

  it('takes the last report in a transcript and skips a torn line', () => {
    const text = [
      'not json',
      JSON.stringify({ message: { role: 'user', content: 'Status: DONE' } }),
      handback('first'),
      JSON.stringify({ message: { role: 'assistant', content: 'last words' } }),
    ].join('\n');
    expect(readLastReport(text)).toEqual({ source: 'text', text: 'last words' });
    expect(readLastReport('')).toBeNull();
  });
});
