// The evidence-existence gate (issue #468 Phase C, R3/D3).
//
// At the completion backstop — right where #394 asserts plan/spec/review — this verifies
// that the ACTIVE feature bundle also carries its four evidence files: `rule-run.jsonl`,
// `duplication.jsonl`, `change-metrics.jsonl`, and `rag.jsonl`. It is BACKFILL-FIRST: a
// missing recoverable file (rule-run / duplication / change-metrics) is minted
// deterministically from the engine caches the live gates already wrote (report.json,
// drift.json, duplication.json) and the live-computed change metrics, marked
// `backfilled: true` so a gate-minted row is never mistaken for a live-seam one. RAG is
// unrecoverable — nothing can reconstruct a retrieval that was never recorded — so a
// genuine RAG gap is reported Inconclusive, naming the file.
//
// It is WARN-ONLY by contract: it NEVER returns `fail` and never sets a blocking decision
// (verify-backstop blocks only on `fail`). That is deliberate — the #310 / #394 /
// pre-mutation false-block history is why this class of completion check has no `strict`
// tier. Flag-aware: a flag-off (duplication/metrics off, RAG dark) reads that file
// skipped, and a non-feature-development / copy-only / no-active-feature change skips the
// whole gate. Best-effort throughout: a backfill or read failure degrades to a note, never
// a throw and never a changed verdict.

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
import { readReport } from '@/rule-scripts/runner.js';

import type { EvidenceExistenceMode } from './evidence-existence-mode.js';

/** The gate marker (not a registered VERIFICATION_GATES member, like `stage-evidence`). */
const GATE_NAME = 'evidence-existence' as VerificationGate;

export interface EvidenceExistenceGateInput {
  projectRoot: string;
  /** The session whose active feature bundle is checked/backfilled. */
  sessionId: string;
  /** The active feature bundle dir, or null when none is open. */
  dirName: string | null;
  /** The resolved gate mode (`off` returns no gate). */
  mode: EvidenceExistenceMode;
  /** Whether this change is feature-development (the gate only applies then). */
  isFeatureDev: boolean;
  /** Whether RAG is enabled (a dark RAG skips the rag.jsonl check). */
  ragEnabled: boolean;
  /** Whether the rule-script scan runs (rule_compliance mode !== 'off'). */
  ruleComplianceOn: boolean;
  /** Whether the duplication scan runs (mode !== 'off'). */
  duplicationOn: boolean;
  /** Whether change-metrics are computed (metrics_enabled). */
  metricsOn: boolean;
  /** The live-computed metrics for this change, used to backfill change-metrics.jsonl. */
  changeMetrics: ChangeMetrics | null;
}

/**
 * Run the evidence-existence check for a change. Returns a warn-only
 * {@link VerificationEvidenceGate} (`pass` / `skipped` / `inconclusive` — never `fail`),
 * or `null` when the knob is `off`. Side effect: mints any recoverable missing bundle file
 * from the caches (best-effort).
 */
export function evidenceExistenceGate(
  input: EvidenceExistenceGateInput,
): VerificationEvidenceGate | null {
  if (input.mode === 'off') {
    return null;
  }
  const { projectRoot, sessionId, dirName } = input;
  // A non-feature / copy-only / chat turn (no active feature bundle) has no evidence files
  // to assert — read skipped, never a block.
  if (!input.isFeatureDev || !dirName) {
    return skipped(
      'No active feature bundle for this change — evidence-existence check not applicable.',
    );
  }

  const present: string[] = [];
  const backfilled: string[] = [];
  const absent: string[] = []; // expected, recoverable, but no cache to mint from
  const flagSkipped: string[] = [];
  let ragMissing = false;

  try {
    // rule-run.jsonl — expected when the rule scan runs; backfill from the rule findings
    // cache (report.json) and the drift cache (drift.json), the same counts the retired
    // rule-evidence rows carried.
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

    // duplication.jsonl — expected when the duplication scan runs; backfill from its cache.
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

    // change-metrics.jsonl — expected when metrics are computed; backfill from the live value.
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

    // rag.jsonl — expected when RAG is enabled; UNRECOVERABLE, so a genuine gap is
    // Inconclusive. Present when either home carries a row (the bundle, or the session's
    // `_chat` home — the documented one-prompt lag lands early rows in `_chat`).
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
  } catch {
    // Fall through to whatever was collected so far.
  }

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

  // RAG is the one unrecoverable gap — report Inconclusive so the developer does not
  // over-trust a bundle whose retrieval evidence was never recorded. Never blocks.
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

  // No evidence file ended up present or backfilled — skipped, not a vacuous pass. This is
  // the every-producing-flag-off case (and the degenerate no-cache case): warn-only, so it
  // reads skipped rather than claiming a pass on zero evidence.
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
  return { name: GATE_NAME, status: 'skipped', detail, remediation: null, failures: [] };
}
