import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { runDuplicationScan } from '@/duplication/scan.js';
import { readDuplicationReport } from '@/duplication/report.js';
import {
  buildDuplicationDecisionContext,
  DUPLICATION_DECISION_CATEGORY,
} from '@/duplication/decisions.js';
import { detectNewCodeDuplication } from '@/duplication/detect.js';

import { commitAll, makeGitProject, writeChunkIndex, writeProjectFile } from './helpers.js';

const HELPER = `export function formatIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
}`;
const NEAR_COPY = HELPER.replace('formatIsoDate', 'toStamp');

const clock = { nowIso: () => '2026-07-20T00:00:00.000Z', nowMs: () => 0 };

function nearCopyProject(): string {
  const root = makeGitProject();
  writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
  commitAll(root);
  writeChunkIndex(root, { 'src/dates.ts': HELPER });
  writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
  return root;
}

describe('runDuplicationScan', () => {
  it('writes the report and blocks in strict mode', async () => {
    const root = nearCopyProject();
    const report = await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'strict', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      clock,
    });
    expect(report.blocking).toBe(true);
    expect(report.counts.deterministic).toBe(1);
    expect(readDuplicationReport(root)).toEqual(report);
  });

  it('resolves changed files from change-evidence when none are passed', async () => {
    // No changedFiles and no clock injected: exercises the git-status fallback and real clock.
    const root = nearCopyProject();
    const report = await runDuplicationScan({
      projectRoot: root,
      config: { mode: 'warn', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.file).toBe('src/stamp.ts');
  });

  it('surfaces the finding without blocking in warn mode', async () => {
    const root = nearCopyProject();
    const report = await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'warn', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      clock,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.blocking).toBe(false);
  });

  it('AC-5: a resolved create-vs-reuse decision unblocks the finding and is noted', async () => {
    const root = nearCopyProject();
    const strict = { mode: 'strict' as const, similarityThreshold: 0.9, minLines: 8 };
    // Reproduce the finding to build the decision context against it.
    const [finding] = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: strict,
      corroborate: false,
    });
    const created = createPendingDecision(root, {
      category: DUPLICATION_DECISION_CATEGORY,
      title: 'Accept the copy',
      context: buildDuplicationDecisionContext(finding!),
      options: [
        { option_key: 'reuse', label: 'Reuse' },
        { option_key: 'accept', label: 'Accept' },
      ],
    });
    resolvePendingDecision(root, created.id, 'accept', 'intentional');

    const report = await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: strict,
      corroborate: false,
      clock,
    });
    expect(report.blocking).toBe(false);
    expect(report.findings[0]!.kind).toBe('heuristic');
    expect(report.resolved_decisions).toEqual([created.id]);
  });

  it('downgrades only the decided finding, leaving another still blocking', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    // Two independent near-copies in two changed files.
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    writeProjectFile(root, 'src/clock.ts', `${HELPER.replace('formatIsoDate', 'toClock')}\n`);
    const strict = { mode: 'strict' as const, similarityThreshold: 0.9, minLines: 8 };
    const changedFiles = ['src/stamp.ts', 'src/clock.ts'];

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles,
      config: strict,
      corroborate: false,
    });
    const stampFinding = findings.find((finding) => finding.file === 'src/stamp.ts')!;
    const created = createPendingDecision(root, {
      category: DUPLICATION_DECISION_CATEGORY,
      title: 'Accept stamp',
      context: buildDuplicationDecisionContext(stampFinding),
      options: [
        { option_key: 'reuse', label: 'Reuse' },
        { option_key: 'accept', label: 'Accept' },
      ],
    });
    resolvePendingDecision(root, created.id, 'accept');

    const report = await runDuplicationScan({
      projectRoot: root,
      changedFiles,
      config: strict,
      corroborate: false,
      clock,
    });
    // clock.ts still blocks; stamp.ts was downgraded to heuristic.
    expect(report.blocking).toBe(true);
    const byFile = Object.fromEntries(
      report.findings.map((finding) => [finding.file, finding.kind]),
    );
    expect(byFile['src/stamp.ts']).toBe('heuristic');
    expect(byFile['src/clock.ts']).toBe('deterministic');
  });
});

describe('evidence-armed pause from a blocking finding (#361)', () => {
  it('opens a create-vs-reuse pause for the blocking finding in strict arm mode', async () => {
    const root = nearCopyProject();
    writeProjectFile(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');
    openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Add a timestamp helper',
      issue: '361',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });

    const report = await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'strict', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      sessionId: 'ses_1',
      clock,
    });

    expect(report.counts.deterministic).toBe(1);
    const pending = readdirSync(join(root, '.paqad/decisions/pending'));
    expect(pending).toHaveLength(1);
    const packet = JSON.parse(
      readFileSync(join(root, '.paqad/decisions/pending', pending[0]), 'utf8'),
    ) as { category: string; origin?: string; options: Array<{ evidence?: { callers?: number } }> };
    expect(packet.category).toBe(DUPLICATION_DECISION_CATEGORY);
    expect(packet.origin).toBe('evidence-armed');
    expect(packet.options[0].evidence?.callers).toBeGreaterThanOrEqual(0);
  });

  it('mints nothing in the shipped warn arm default', async () => {
    const root = nearCopyProject();
    openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Add a timestamp helper',
      issue: '361',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });

    await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'strict', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      sessionId: 'ses_1',
      clock,
    });
    expect(existsSync(join(root, '.paqad/decisions/pending'))).toBe(false);
  });

  it('arms nothing when no feature is active to attribute the pause to', async () => {
    const root = nearCopyProject();
    writeProjectFile(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');

    await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'strict', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      sessionId: 'ses_no_feature',
      clock,
    });
    expect(existsSync(join(root, '.paqad/decisions/pending'))).toBe(false);
  });

  it('arms nothing when the scan produced no blocking finding', async () => {
    const root = makeGitProject();
    writeProjectFile(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeProjectFile(root, 'src/unrelated.ts', 'export const answer = 42;\n');
    openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Add an answer',
      issue: '361',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });

    await runDuplicationScan({
      projectRoot: root,
      changedFiles: ['src/unrelated.ts'],
      config: { mode: 'strict', similarityThreshold: 0.9, minLines: 8 },
      corroborate: false,
      sessionId: 'ses_1',
      clock,
    });
    expect(existsSync(join(root, '.paqad/decisions/pending'))).toBe(false);
  });
});
