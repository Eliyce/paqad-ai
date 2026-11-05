import { describe, expect, it } from 'vitest';

import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { bundleLedgerEra, stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { stageStartRefusal } from '@/stage-isolation/stage-handback.js';

const row = (fields: Record<string, unknown>): SessionLedgerRow =>
  ({ schema_version: 3, content_hash: 'h', agent_id: 'a1', ...fields }) as SessionLedgerRow;

const opened = row({ kind: 'open' });

const report = (stage: string, status: string, extra: Record<string, unknown> = {}) =>
  row({
    kind: 'stage-agent',
    event_status: 'completed',
    stage,
    report_status: status,
    report_stated: true,
    report_source: 'text',
    advance: status === 'DONE',
    reason: `${stage} is stuck`,
    ...extra,
  });

const reviewEnd = row({
  kind: 'stage_end',
  stage: 'review',
  artifact_digest: 'd',
  artifact_paths: ['x/review.json'],
});

describe('stage start refuses a later stage past an unfinished one', () => {
  it.each(['BLOCKED', 'NEEDS_CONTEXT'])('refuses checks past a stated %s review', (status) => {
    const refusal = stageStartRefusal([opened, report('review', status)], 'checks', 'full');
    expect(refusal?.stage).toBe('review');
    expect(refusal?.message).toContain('review');
    expect(refusal?.message).toContain('review is stuck');
    expect(refusal?.message).toContain('Next:');
  });

  it('refuses past a paused report, naming the decision', () => {
    const refusal = stageStartRefusal(
      [opened, report('review', 'BLOCKED', { decision: 'D-01ABC' })],
      'checks',
      'full',
    );
    expect(refusal?.message).toContain('D-01ABC');
  });

  it('judges the stage the agent carried on to, not the stage its row names', () => {
    const rows = [
      opened,
      row({ kind: 'stage_start', stage: 'specification' }),
      report('planning', 'BLOCKED', { stages: ['planning', 'specification'] }),
    ];
    expect(stageStartRefusal(rows, 'development', 'full')?.stage).toBe('specification');
  });

  it('AC-25: leaves review and documentation sync side by side', () => {
    const blocked = [opened, report('review', 'BLOCKED')];
    expect(stageStartRefusal(blocked, 'documentation_sync', 'full')).toBeNull();
    expect(
      stageStartRefusal([opened, report('documentation_sync', 'BLOCKED')], 'review', 'full'),
    ).toBeNull();
  });

  it('AC-25: leaves development resumed for a review or checks fix', () => {
    expect(
      stageStartRefusal([opened, report('review', 'BLOCKED')], 'development', 'full'),
    ).toBeNull();
    expect(
      stageStartRefusal([opened, report('checks', 'BLOCKED')], 'development', 'full'),
    ).toBeNull();
  });

  it('AC-25: leaves a resumed agent restarting its own stage', () => {
    expect(stageStartRefusal([opened, report('review', 'BLOCKED')], 'review', 'full')).toBeNull();
  });

  it.each(['fast', 'graduated'] as const)('AC-25: leaves the %s lane', (lane) => {
    expect(stageStartRefusal([opened, report('review', 'BLOCKED')], 'checks', lane)).toBeNull();
  });

  it('AC-25: leaves an inline run with no report rows', () => {
    const rows = [opened, row({ kind: 'stage_start', stage: 'review', agent: 'orchestrator' })];
    expect(stageStartRefusal(rows, 'checks', 'full')).toBeNull();
  });

  it('AC-25: leaves an older bundle', () => {
    const rows = [row({ kind: 'open', schema_version: 2 }), report('review', 'BLOCKED')];
    expect(stageStartRefusal(rows, 'checks', 'full')).toBeNull();
  });

  it('AC-25: leaves a report nobody stated', () => {
    const none = report('review', 'BLOCKED', { report_source: 'none', report_stated: false });
    expect(stageStartRefusal([opened, none], 'checks', 'full')).toBeNull();
  });

  it('ignores a refused handback that can still retry', () => {
    const denied = report('review', 'DONE', { kind: 'stage-handback', event_status: 'denied' });
    expect(stageStartRefusal([opened, denied], 'checks', 'full')).toBeNull();
  });

  it('AC-26: clears on a later end row with its artifact or a newer DONE', () => {
    const blocked = report('review', 'BLOCKED');
    expect(stageStartRefusal([opened, blocked, reviewEnd], 'checks', 'full')).toBeNull();
    const done = report('review', 'DONE');
    expect(stageStartRefusal([opened, blocked, done], 'checks', 'full')).toBeNull();
  });

  it('does not clear on an end row from before the report', () => {
    const rows = [opened, reviewEnd, report('review', 'BLOCKED')];
    expect(stageStartRefusal(rows, 'checks', 'full')?.stage).toBe('review');
  });

  it('counts the newest report across agents after a fresh dispatch', () => {
    const rows = [
      opened,
      report('review', 'BLOCKED', { agent_id: 'a1' }),
      report('review', 'DONE', { agent_id: 'a2' }),
    ];
    expect(stageStartRefusal(rows, 'checks', 'full')).toBeNull();
  });
});

describe('ledger era', () => {
  it('reads a bundle by its first row', () => {
    expect(bundleLedgerEra([opened])).toBe('v3');
    expect(bundleLedgerEra([row({ kind: 'open', schema_version: 2 }), opened])).toBe('legacy');
    expect(bundleLedgerEra([])).toBe('legacy');
  });

  it('reads a stage by its newest start', () => {
    const start = (version: number) =>
      row({ kind: 'stage_start', stage: 'review', schema_version: version });
    expect(stageLedgerEra([start(2), start(3)], 'review')).toBe('v3');
    expect(stageLedgerEra([start(3), start(2)], 'review')).toBe('legacy');
    expect(stageLedgerEra([start(3)], 'checks')).toBe('legacy');
  });
});
