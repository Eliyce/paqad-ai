import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { latestFeatureReceipt, readAllFeatureReceipts } from '@/feature-evidence/receipt.js';
import type { ChangeAuthorship } from '@/core/types/evidence-ledger.js';

import type { SectionData } from '../types.js';

const HELPER = {
  what: 'Append-only, tamper-evident chain of signed per-change receipts (.paqad/ledger/receipts.jsonl). Each receipt is gate-derived: it attests that paqad’s verification gates passed for a change, and records which adapter/model wrote it and which human accepted it.',
  goodLooksLike:
    'A growing chain whose latest receipt shows PASSED with an attributed author. Because the trust is gate-derived, the receipt vouches for the change whichever AI tool produced it.',
} as const;

export interface AttestationResult {
  section: SectionData;
}

function authorLabel(authorship: ChangeAuthorship | null): string {
  if (authorship === null) return 'unattributed';
  const parts: string[] = [];
  if (authorship.agent !== undefined) parts.push(authorship.agent);
  const model = authorship.model_id ?? authorship.model;
  if (model !== undefined) parts.push(model);
  return parts.length > 0 ? parts.join(' / ') : 'unattributed';
}

export function collectAttestation(projectRoot: string): AttestationResult {
  const receipts = readAllFeatureReceipts(projectRoot);

  if (receipts.length === 0) {
    return {
      section: {
        id: 'attestation',
        title: 'Attestation',
        band: 'unknown',
        score: null,
        summary: 'No attestation receipts yet.',
        metrics: [],
        helper: HELPER,
      },
    };
  }

  const latest = latestFeatureReceipt(projectRoot);
  const statement = latest ? decodeReceiptStatement(latest) : null;
  const authorship = statement?.predicate.change_authorship ?? null;
  const result = statement?.predicate.verification_result ?? 'FAILED';
  const acceptedBy = authorship?.accepting_human?.name;

  const metrics = [
    { label: 'Latest result', value: result },
    { label: 'Written by', value: authorLabel(authorship) },
    { label: 'Accepted by', value: acceptedBy ?? '—' },
  ];

  return {
    section: {
      id: 'attestation',
      title: 'Attestation',
      band: 'green',
      score: 100,
      summary: `${receipts.length} receipt(s) · latest ${result} · ${authorLabel(authorship)}`,
      metrics,
      helper: HELPER,
      details: {
        total: receipts.length,
        latest_result: result,
        latest_authorship: authorship,
      },
    },
  };
}
