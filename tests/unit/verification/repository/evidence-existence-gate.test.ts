import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { ChangeMetrics } from '@/change-metrics/types.js';
import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendRuleRun,
  readChangeMetrics,
  readDuplication,
  readRuleRun,
} from '@/feature-evidence/bundle-ledgers.js';
import { chatRagPath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { appendStampedRowToUnit, stampSessionRow } from '@/session-ledger/ledger.js';
import type { DuplicationReport } from '@/duplication/report.js';
import {
  evidenceExistenceGate,
  type EvidenceExistenceGateInput,
} from '@/verification/repository/evidence-existence-gate.js';

const SES = 'ses_exist';

const METRICS: ChangeMetrics = {
  dup_new_pct: 0,
  reuse_rate: 5,
  meaningful_changed_lines: 10,
  inputs: {
    flagged_lines: 0,
    reuse_calls: 1,
    duplication_report_present: true,
    index_present: true,
  },
};

const DUP_REPORT: DuplicationReport = {
  generated_at: '2026-01-01T00:00:00.000Z',
  findings: [],
  counts: { deterministic: 0, heuristic: 0 },
  similarity_threshold: 0.9,
  min_lines: 8,
  mode: 'warn',
  blocking: false,
  elapsed_ms: 1,
  resolved_decisions: [],
} as unknown as DuplicationReport;

describe('evidenceExistenceGate (issue #468 Phase C)', () => {
  let root: string;
  let dir: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-eeg-'));
    sessionId = resolveSessionId(root, SES);
    dir = openFeatureChange(root, sessionId, { adapter: 'claude-code', title: 'F', issue: null });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function baseInput(over: Partial<EvidenceExistenceGateInput> = {}): EvidenceExistenceGateInput {
    return {
      projectRoot: root,
      sessionId,
      dirName: dir,
      mode: 'warn',
      isFeatureDev: true,
      ragEnabled: true,
      ruleComplianceOn: true,
      duplicationOn: true,
      metricsOn: true,
      changeMetrics: METRICS,
      ...over,
    };
  }

  /** Seed a `_chat` rag row so the rag.jsonl check passes. */
  function seedChatRag(): void {
    const row = stampSessionRow('paqad.rag-evidence', sessionId, {
      kind: 'used',
      conversation_ordinal: 1,
      rag_enabled: true,
      adapter: 'claude-code',
      injected: true,
    });
    appendStampedRowToUnit(root, chatRagPath(sessionId), row);
  }

  function writeJson(relPath: string, value: unknown): void {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(value), 'utf8');
  }

  it('returns null when the mode is off', () => {
    expect(evidenceExistenceGate(baseInput({ mode: 'off' }))).toBeNull();
  });

  it('is skipped for a non-feature-development change', () => {
    const gate = evidenceExistenceGate(baseInput({ isFeatureDev: false }));
    expect(gate?.status).toBe('skipped');
  });

  it('is skipped when no feature bundle is active', () => {
    const gate = evidenceExistenceGate(baseInput({ dirName: null }));
    expect(gate?.status).toBe('skipped');
  });

  it('passes when every expected file is already present (no backfill)', () => {
    appendRuleRun(root, sessionId, {
      kind: 'findings',
      counts: { deterministic: 0 },
      blocking: false,
    });
    appendDuplicationRun(root, sessionId, DUP_REPORT);
    appendChangeMetrics(root, sessionId, METRICS);
    seedChatRag();

    const gate = evidenceExistenceGate(baseInput());
    expect(gate?.status).toBe('pass');
    expect(gate?.detail).not.toContain('Backfilled');
    // No gate-minted rows — the live rows are the only ones.
    expect(readRuleRun(root, dir).every((r) => r.backfilled === undefined)).toBe(true);
  });

  it('backfills the recoverable files from the caches (marked backfilled:true) and passes', () => {
    // Bundle files absent, but the engine caches are present.
    writeJson(PATHS.RULE_SCRIPTS_REPORT, {
      counts: { deterministic: 2, heuristic: 1, skipped: 0 },
      blocking: false,
    });
    writeJson(PATHS.RULE_SCRIPTS_DRIFT, { blocked: false, counts: { 'RS-RULE-EDITED': 1 } });
    writeJson(PATHS.DUPLICATION_REPORT, DUP_REPORT);
    seedChatRag();

    const gate = evidenceExistenceGate(baseInput());
    expect(gate?.status).toBe('pass');
    expect(gate?.detail).toContain('Backfilled from cache');

    // The gate minted rows into the bundle, each marked backfilled:true.
    const ruleRows = readRuleRun(root, dir);
    expect(ruleRows.length).toBeGreaterThan(0);
    expect(ruleRows.every((r) => r.backfilled === true)).toBe(true);
    expect(readDuplication(root, dir).every((r) => r.backfilled === true)).toBe(true);
    // change-metrics is backfilled from the live value passed in.
    const metricRows = readChangeMetrics(root, dir);
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0].backfilled).toBe(true);
  });

  it('reports Inconclusive naming rag.jsonl when RAG is enabled but no retrieval row exists', () => {
    // Recoverable files present so only rag is missing.
    appendRuleRun(root, sessionId, {
      kind: 'findings',
      counts: { deterministic: 0 },
      blocking: false,
    });
    appendDuplicationRun(root, sessionId, DUP_REPORT);
    appendChangeMetrics(root, sessionId, METRICS);

    const gate = evidenceExistenceGate(baseInput());
    expect(gate?.status).toBe('inconclusive');
    expect(gate?.detail).toContain('rag.jsonl');
  });

  it('skips a flag-off file: RAG-dark does not make the gate inconclusive', () => {
    appendRuleRun(root, sessionId, {
      kind: 'findings',
      counts: { deterministic: 0 },
      blocking: false,
    });
    const gate = evidenceExistenceGate(
      baseInput({ ragEnabled: false, duplicationOn: false, metricsOn: false }),
    );
    expect(gate?.status).toBe('pass');
    expect(gate?.detail).toContain('Skipped (flag off)');
    expect(gate?.detail).toContain('rag.jsonl');
  });

  it('is skipped when every producing flag is off (nothing expected)', () => {
    const gate = evidenceExistenceGate(
      baseInput({
        ruleComplianceOn: false,
        ragEnabled: false,
        duplicationOn: false,
        metricsOn: false,
      }),
    );
    expect(gate?.status).toBe('skipped');
    expect(gate?.detail).toContain('Skipped (flag off)');
  });

  it('never returns a fail status', () => {
    // A degenerate change with nothing present, no caches, rag dark.
    const gate = evidenceExistenceGate(
      baseInput({ ragEnabled: false, duplicationOn: false, metricsOn: false, changeMetrics: null }),
    );
    expect(gate?.status).not.toBe('fail');
  });
});
