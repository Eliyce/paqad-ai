// Issue #121 — aggregate the #118 evidence ledger and tamper-evident receipt
// chain into one chronological stream of format-neutral SiemEvents.
//
// This deliberately reads the *unified* ledger #118 already produced rather than
// re-reconciling the three legacy, format-inconsistent logs (plain-text
// audit.log, decisions/audit.jsonl, skills/events.jsonl): the unified ledger is
// already graded (deterministic vs LLM-judged), already content-addressed, and
// the receipt chain already carries the hash-chain seal and the #120 authorship.
// Exporting that is both less code and strictly richer evidence.

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

/** Drop `undefined`-valued optional keys so authorship objects stay minimal. */
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

/** Each graded ledger row → one evidence event (issue #468: from the bundle union). */
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

/**
 * Each per-feature receipt → one attestation event (issue #468 Phase B). After the cutover
 * each feature bundle carries its own self-chained receipt, so there is no single whole-
 * project chain: every bundle receipt is verified INDEPENDENTLY for its own byte integrity
 * (`verifyReceiptSeal`), and `sealed` reflects that per-feature check.
 */
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

// ── #249 session-ledger fold ──────────────────────────────────────────────────
// The always-on session-ledger carries the governance feed the dashboard reads
// (decision lifecycle, delivery detection, stage evidence, plus the disabled-session
// audit, health, and site-map runs). Union it into the SIEM stream so an external SOC
// sees the same evidence — not just the enterprise-gated #118 ledger.
// Stage evidence is PROJECTED from the per-feature bundles (issue #339); rule-run and
// change-metrics evidence are likewise PROJECTED from the bundles (issue #468 Phase B) —
// the retired `rule-evidence/` and `change-metrics/` project-ledger dirs are no longer
// walked. The remaining doc types below stay project/session-scoped.
const SESSION_LEDGER_DOC_TYPES = [
  DECISION_EVIDENCE_DOC_TYPE,
  DELIVERY_EVIDENCE_DOC_TYPE,
  DISABLED_SESSION_DOC_TYPE,
  HEALTH_RUN_DOC_TYPE,
  SITE_MAP_RUN_DOC_TYPE,
] as const;

/**
 * Grade a session-ledger row into the SIEM verdict vocabulary the formatters
 * already understand. A blocking/failed row is a finding a SOC wants surfaced
 * (graded severity); a lifecycle event (opened/resolved/detected/disabled) is
 * informational provenance and falls through to its `kind` (Unknown severity).
 */
function sessionVerdict(row: SessionLedgerRow): string {
  if (row.doc_type === DISABLED_SESSION_DOC_TYPE) return 'disabled';
  if (row.blocking === true || row.blocked === true) return 'blocked';
  if (row.event_status === 'failed') return 'fail';
  if (row.event_status === 'completed') return 'pass';
  if (typeof row.event_status === 'string') return row.event_status;
  return typeof row.kind === 'string' ? row.kind : 'recorded';
}

/** A short, redactable human summary of a session-ledger row, per doc type. */
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
      // A bundle change-metrics row carries the ratios directly; guard the (absent) open
      // marker shape defensively so a marker row would surface as the plain kind, not a
      // misleading `change shape · n/a` line.
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

/** Project one session-ledger row into a `session` SiemEvent. */
function sessionEvent(row: SessionLedgerRow): SiemEvent {
  return {
    kind: 'session',
    ts: row.ts,
    code: row.doc_type,
    doc_type: row.doc_type,
    session_id: row.session_id,
    verdict: sessionVerdict(row),
    content_hash: row.content_hash,
    detail: sessionDetail(row),
  };
}

/**
 * Every session-ledger row across the folded doc types → one `session` event each, PLUS
 * the stage-evidence rows projected from the per-feature bundles (issue #339). Stage rows
 * keep the same `doc_type`/shape, so the same `sessionEvent` mapper grades them.
 */
function sessionLedgerEvents(projectRoot: string): SiemEvent[] {
  const fromLedger = SESSION_LEDGER_DOC_TYPES.flatMap((docType) =>
    readAllSessionRows(projectRoot, docType).map(sessionEvent),
  );
  // Issue #339 / #468 Phase B — stage evidence, rule-run findings, and change-metrics are
  // projected from the per-feature bundles, not the session-scoped ledger layout. Each row
  // keeps its own `doc_type`/shape, so the same `sessionEvent`/`sessionDetail` mapper grades
  // them (RULE_RUN_DOC_TYPE / CHANGE_METRICS_RUN_DOC_TYPE cases above).
  const fromFeatures = [
    ...readAllFeatureStageRows(projectRoot),
    ...readAllFeatureRuleRuns(projectRoot),
    ...readAllFeatureChangeMetrics(projectRoot),
  ].map(sessionEvent);
  return [...fromLedger, ...fromFeatures];
}

/**
 * Read the ledger and the receipt chain and merge them into one chronological
 * stream (oldest first), so a SIEM ingests events in the order they occurred.
 * Events with an unparseable/empty `ts` sort to the front deterministically.
 */
export function aggregateSiemEvents(projectRoot: string): SiemEvent[] {
  const events = [
    ...evidenceEvents(projectRoot),
    ...attestationEvents(projectRoot),
    ...sessionLedgerEvents(projectRoot),
  ];
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}
