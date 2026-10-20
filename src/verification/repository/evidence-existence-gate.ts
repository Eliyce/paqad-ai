import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { VerificationGate } from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendRuleRun,
  readChangeMetrics,
  readDuplication,
  readRuleRun,
} from '@/feature-evidence/bundle-ledgers.js';
import { chatRagPath, featureFilePath } from '@/feature-evidence/paths.js';
import { readUnitFile } from '@/session-ledger/ledger.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { readDrift } from '@/rule-scripts/reconciler.js';
import { readReport, ruleRunFindings } from '@/rule-scripts/runner.js';

import type { EvidenceExistenceMode } from './evidence-existence-mode.js';

const GATE_NAME = 'evidence-existence' as VerificationGate;

export interface EvidenceExistenceGateInput {
  projectRoot: string;
  sessionId: string;
  dirName: string | null;
  mode: EvidenceExistenceMode;
  isFeatureDev: boolean;
  ragEnabled: boolean;
  ruleComplianceOn: boolean;
  duplicationOn: boolean;
  metricsOn: boolean;
  changeMetrics: ChangeMetrics | null;
}

export function evidenceExistenceGate(
  input: EvidenceExistenceGateInput,
): VerificationEvidenceGate | null {
  if (input.mode === 'off') {
    return null;
  }
  const { projectRoot, sessionId, dirName } = input;
  if (!input.isFeatureDev || !dirName) {
    return skipped(
      'No active feature bundle for this change — evidence-existence check not applicable.',
    );
  }

  const present: string[] = [];
  const backfilled: string[] = [];
  const absent: string[] = [];
  const flagSkipped: string[] = [];
  let ragMissing = false;

  try {
    if (!input.ruleComplianceOn) {
      flagSkipped.push('rule-run.jsonl');
    } else if (readRuleRun(projectRoot, dirName).length > 0) {
      present.push('rule-run.jsonl');
    } else {
      let minted = false;
      const report = readReport(projectRoot);
      if (report) {
        appendRuleRun(projectRoot, sessionId, {
          kind: 'findings',
          counts: report.counts as unknown as Record<string, number>,
          blocking: report.blocking,
          findings: ruleRunFindings(report),
          backfilled: true,
        });
        minted = true;
      }
      const drift = readDrift(projectRoot);
      if (drift) {
        appendRuleRun(projectRoot, sessionId, {
          kind: 'drift',
          counts: drift.counts,
          blocking: drift.blocked,
          backfilled: true,
        });
        minted = true;
      }
      (minted ? backfilled : absent).push('rule-run.jsonl');
    }

    if (!input.duplicationOn) {
      flagSkipped.push('duplication.jsonl');
    } else if (readDuplication(projectRoot, dirName).length > 0) {
      present.push('duplication.jsonl');
    } else {
      const report = readDuplicationReport(projectRoot);
      if (report) {
        appendDuplicationRun(projectRoot, sessionId, report, undefined, true);
        backfilled.push('duplication.jsonl');
      } else {
        absent.push('duplication.jsonl');
      }
    }

    if (!input.metricsOn) {
      flagSkipped.push('change-metrics.jsonl');
    } else if (readChangeMetrics(projectRoot, dirName).length > 0) {
      present.push('change-metrics.jsonl');
    } else if (input.changeMetrics) {
      appendChangeMetrics(projectRoot, sessionId, input.changeMetrics, undefined, true);
      backfilled.push('change-metrics.jsonl');
    } else {
      absent.push('change-metrics.jsonl');
    }

    if (!input.ragEnabled) {
      flagSkipped.push('rag.jsonl');
    } else if (
      readUnitFile(projectRoot, featureFilePath(dirName, 'rag')).length > 0 ||
      readUnitFile(projectRoot, chatRagPath(sessionId)).length > 0
    ) {
      present.push('rag.jsonl');
    } else {
      ragMissing = true;
    }
    /* v8 ignore next 4 -- best-effort: a read/backfill failure must never change the
       verdict; a filesystem fault is not reproduced in tests. */
  } catch {}

  return decide({ present, backfilled, absent, flagSkipped, ragMissing });
}

function decide(state: {
  present: string[];
  backfilled: string[];
  absent: string[];
  flagSkipped: string[];
  ragMissing: boolean;
}): VerificationEvidenceGate {
  const madeGood = [...state.present, ...state.backfilled];
  const backfillNote =
    state.backfilled.length > 0 ? ` Backfilled from cache: ${state.backfilled.join(', ')}.` : '';
  const skipNote =
    state.flagSkipped.length > 0 ? ` Skipped (flag off): ${state.flagSkipped.join(', ')}.` : '';
  const absentNote =
    state.absent.length > 0 ? ` Absent, no cache to backfill: ${state.absent.join(', ')}.` : '';

  if (state.ragMissing) {
    return {
      name: GATE_NAME,
      status: 'inconclusive',
      detail:
        'Inconclusive — rag.jsonl is absent for this feature (no bundle or _chat retrieval ' +
        `row recorded); RAG evidence is unrecoverable.${backfillNote}${absentNote}`,
      remediation: null,
      failures: [],
    };
  }

  if (madeGood.length === 0) {
    return skipped(`No evidence files present for this change.${skipNote}${absentNote}`);
  }

  return {
    name: GATE_NAME,
    status: 'pass',
    detail:
      `Evidence files present for this feature: ${madeGood.join(', ')}.` +
      `${backfillNote}${skipNote}${absentNote}`,
    remediation: null,
    failures: [],
  };
}

function skipped(detail: string): VerificationEvidenceGate {
  return {
    name: GATE_NAME,
    status: 'skipped',
    detail,
    remediation: null,
    failures: [],
    skip_kind: 'not-required',
  };
}
