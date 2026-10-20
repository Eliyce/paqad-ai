import type { ChangeAuthorship } from '@/core/types/evidence-ledger.js';
import { verifyReceiptSeal } from '@/evidence/receipt/dsse.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { DELIVERY_EVIDENCE_DOC_TYPE } from '@/delivery/delivery-ledger.js';
import { DECISION_EVIDENCE_DOC_TYPE } from '@/planning/decision-ledger.js';
import { readAllSessionRows, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  readAllFeatureChangeMetrics,
  readAllFeatureEvidence,
  readAllFeatureRuleRuns,
  readAllFeatureStageRows,
} from '@/feature-evidence/projections.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { readAllFeatureReceipts } from '@/feature-evidence/receipt.js';
import {
  CHANGE_METRICS_RUN_DOC_TYPE,
  RULE_RUN_DOC_TYPE,
} from '@/feature-evidence/bundle-ledgers.js';
import { DISABLED_SESSION_DOC_TYPE } from '@/session-ledger/disabled-audit.js';
import { HEALTH_RUN_DOC_TYPE } from '@/codebase-health/ledger.js';
import { SITE_MAP_RUN_DOC_TYPE } from '@/site-map/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import type { SiemAuthorship, SiemEvent } from './types.js';

function mapAuthorship(authorship: ChangeAuthorship): SiemAuthorship {
  const human = authorship.accepting_human;
  return {
    ...(authorship.agent !== undefined ? { agent: authorship.agent } : {}),
    ...(authorship.model !== undefined ? { model: authorship.model } : {}),
    ...(authorship.provider !== undefined ? { provider: authorship.provider } : {}),
    ...(authorship.model_id !== undefined ? { model_id: authorship.model_id } : {}),
    ...(human !== undefined
      ? {
          accepting_human: {
            ...(human.name !== undefined ? { name: human.name } : {}),
            ...(human.email !== undefined ? { email: human.email } : {}),
          },
        }
      : {}),
    provenance: authorship.provenance,
  };
}

function evidenceEvents(projectRoot: string): SiemEvent[] {
  return readAllFeatureEvidence(projectRoot).map((row) => ({
    kind: 'evidence',
    ts: row.ts,
    engine: row.engine,
    code: row.code,
    verdict: row.verdict,
    subject_digest: row.subject_digest,
    strength_class: row.strength_class,
    content_hash: row.content_hash,
    ...(row.detail !== undefined ? { detail: row.detail } : {}),
  }));
}

function attestationEvents(projectRoot: string): SiemEvent[] {
  return readAllFeatureReceipts(projectRoot).map((envelope, index): SiemEvent => {
    const statement = decodeReceiptStatement(envelope);
    const predicate = statement?.predicate ?? null;
    const sealed = verifyReceiptSeal(envelope);
    return {
      kind: 'attestation',
      ts: predicate?.time_verified ?? '',
      code: 'receipt',
      verdict: predicate?.verification_result ?? 'unknown',
      content_hash: envelope.paqad.receipt_hash,
      receipt_index: index,
      receipt_hash: envelope.paqad.receipt_hash,
      prev_receipt_hash: envelope.paqad.prev_receipt_hash,
      signing_mode: envelope.paqad.signing_mode,
      sealed,
      subjects: (statement?.subject ?? []).map((subject) => ({
        name: subject.name,
        sha256: subject.digest.sha256,
      })),
      ...(predicate?.change_authorship !== undefined
        ? { authorship: mapAuthorship(predicate.change_authorship) }
        : {}),
      ...(predicate !== null
        ? { detail: summarizeReceipt(predicate.verification_result, sealed) }
        : {}),
    };
  });
}

function summarizeReceipt(result: 'PASSED' | 'FAILED' | 'INCONCLUSIVE', sealed: boolean): string {
  return `verification ${result}; chain ${sealed ? 'sealed' : 'BROKEN'}`;
}

const SESSION_LEDGER_DOC_TYPES = [
  DECISION_EVIDENCE_DOC_TYPE,
  DELIVERY_EVIDENCE_DOC_TYPE,
  DISABLED_SESSION_DOC_TYPE,
  HEALTH_RUN_DOC_TYPE,
  SITE_MAP_RUN_DOC_TYPE,
] as const;

function sessionVerdict(row: SessionLedgerRow): string {
  if (row.doc_type === DISABLED_SESSION_DOC_TYPE) return 'disabled';
  if (row.blocking === true || row.blocked === true) return 'blocked';
  if (row.event_status === 'failed') return 'fail';
  if (row.event_status === 'completed') return 'pass';
  if (typeof row.event_status === 'string') return row.event_status;
  return typeof row.kind === 'string' ? row.kind : 'recorded';
}

function sessionDetail(row: SessionLedgerRow): string {
  const kind = typeof row.kind === 'string' ? row.kind : 'record';
  switch (row.doc_type) {
    case DECISION_EVIDENCE_DOC_TYPE:
      return typeof row.decision_id === 'string' ? `${kind} ${row.decision_id}` : kind;
    case DELIVERY_EVIDENCE_DOC_TYPE: {
      const host = (row.detected as { host?: { value?: string } } | undefined)?.host?.value;
      return host !== undefined ? `detected host=${host}` : kind;
    }
    case RULE_RUN_DOC_TYPE:
      if (kind === 'drift') return `drift ${row.blocked === true ? 'blocked' : 'clean'}`;
      if (kind === 'findings') return `findings ${row.blocking === true ? 'blocking' : 'clean'}`;
      return kind;
    case STAGE_EVIDENCE_DOC_TYPE:
      return typeof row.stage === 'string' ? `${kind} stage=${row.stage}` : kind;
    case DISABLED_SESSION_DOC_TYPE:
      return typeof row.reason === 'string' ? `disabled (${row.reason})` : 'disabled';
    case HEALTH_RUN_DOC_TYPE: {
      const count = typeof row.finding_count === 'number' ? row.finding_count : 0;
      return `health run ${typeof row.report_id === 'string' ? row.report_id : ''} · ${count} finding(s)`.trim();
    }
    case SITE_MAP_RUN_DOC_TYPE: {
      const count = typeof row.finding_count === 'number' ? row.finding_count : 0;
      const surfaces = typeof row.surface_count === 'number' ? row.surface_count : 0;
      return `site-map run ${typeof row.report_id === 'string' ? row.report_id : ''} · ${surfaces} surface(s) · ${count} finding(s)`.trim();
    }
    case CHANGE_METRICS_RUN_DOC_TYPE: {
      if (typeof row.meaningful_changed_lines !== 'number') {
        return kind;
      }
      const dup = typeof row.dup_new_pct === 'number' ? `${row.dup_new_pct}%` : 'n/a';
      const reuse = typeof row.reuse_rate === 'number' ? row.reuse_rate.toFixed(1) : 'n/a';
      const lines =
        typeof row.meaningful_changed_lines === 'number' ? row.meaningful_changed_lines : 0;
      return `change shape · ${dup} dup, ${reuse} reuse/100 (${lines} lines)`;
    }
    default:
      return kind;
  }
}

function sessionEvent(row: SessionLedgerRow): SiemEvent {
  return {
    kind: 'session',
    ts: rowRecordedAt(row) ?? '',
    code: row.doc_type,
    doc_type: row.doc_type,
    session_id: row.session_id,
    verdict: sessionVerdict(row),
    content_hash: row.content_hash,
    detail: sessionDetail(row),
  };
}

function sessionLedgerEvents(projectRoot: string): SiemEvent[] {
  const fromLedger = SESSION_LEDGER_DOC_TYPES.flatMap((docType) =>
    readAllSessionRows(projectRoot, docType).map(sessionEvent),
  );
  const fromFeatures = [
    ...readAllFeatureStageRows(projectRoot),
    ...readAllFeatureRuleRuns(projectRoot),
    ...readAllFeatureChangeMetrics(projectRoot),
  ].map(sessionEvent);
  return [...fromLedger, ...fromFeatures];
}

export function aggregateSiemEvents(projectRoot: string): SiemEvent[] {
  const events = [
    ...evidenceEvents(projectRoot),
    ...attestationEvents(projectRoot),
    ...sessionLedgerEvents(projectRoot),
  ];
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}
