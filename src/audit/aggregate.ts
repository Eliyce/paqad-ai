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

/**
 * Read the ledger and the receipt chain and merge them into one chronological
 * stream (oldest first), so a SIEM ingests events in the order they occurred.
 * Events with an unparseable/empty `ts` sort to the front deterministically.
 */
export function aggregateSiemEvents(projectRoot: string): SiemEvent[] {
  const events = [...evidenceEvents(projectRoot), ...attestationEvents(projectRoot)];
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}
