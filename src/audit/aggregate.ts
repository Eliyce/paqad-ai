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
import { readEvidenceLedger } from '@/evidence/ledger.js';
import { verifyReceiptChain } from '@/evidence/receipt/dsse.js';
import { decodeReceiptStatement, readReceiptChain } from '@/evidence/receipt/project.js';
import { DELIVERY_EVIDENCE_DOC_TYPE } from '@/delivery/delivery-ledger.js';
import { DECISION_EVIDENCE_DOC_TYPE } from '@/planning/decision-ledger.js';
import { RULE_EVIDENCE_DOC_TYPE } from '@/rule-scripts/rule-ledger.js';
import { readAllSessionRows, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import { readAllFeatureStageRows } from '@/feature-evidence/projections.js';
import { DISABLED_SESSION_DOC_TYPE } from '@/session-ledger/disabled-audit.js';
import { HEALTH_RUN_DOC_TYPE } from '@/codebase-health/ledger.js';
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

/** Each graded ledger row → one evidence event. */
function evidenceEvents(projectRoot: string): SiemEvent[] {
  return readEvidenceLedger(projectRoot).map((row) => ({
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

/** Each receipt → one attestation event, stamped with its chain seal status. */
function attestationEvents(projectRoot: string): SiemEvent[] {
  const chain = readReceiptChain(projectRoot);
  // verifyReceiptChain returns the index of the first broken link, or null when
  // the whole chain recomputes cleanly. A receipt is sealed iff it precedes the
  // first break (or there is none).
  const brokenAt = verifyReceiptChain(chain);
  return chain.map((envelope, index): SiemEvent => {
    const statement = decodeReceiptStatement(envelope);
    const predicate = statement?.predicate ?? null;
    const sealed = brokenAt === null || index < brokenAt;
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

function summarizeReceipt(result: 'PASSED' | 'FAILED', sealed: boolean): string {
  return `verification ${result}; chain ${sealed ? 'sealed' : 'BROKEN'}`;
}

// ── #249 session-ledger fold ──────────────────────────────────────────────────
// The always-on session-ledger carries the governance feed the dashboard reads
// (decision lifecycle, delivery detection, rule compliance, stage evidence, plus
// the disabled-session audit). Union it into the SIEM stream so an external SOC
// sees the same evidence — not just the enterprise-gated #118 ledger. These doc
// types are the same five the dashboard collectors consume after the F6 cutover.
// Stage evidence is PROJECTED from the per-feature bundles (issue #339), not read from
// the session-scoped ledger layout — the Phase-2 cutover moved it into the feature dirs.
// The other four doc types stay project/session-scoped, so they are still walked here.
const SESSION_LEDGER_DOC_TYPES = [
  DECISION_EVIDENCE_DOC_TYPE,
  DELIVERY_EVIDENCE_DOC_TYPE,
  RULE_EVIDENCE_DOC_TYPE,
  DISABLED_SESSION_DOC_TYPE,
  HEALTH_RUN_DOC_TYPE,
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
    case RULE_EVIDENCE_DOC_TYPE:
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
  const fromFeatures = readAllFeatureStageRows(projectRoot).map(sessionEvent);
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
