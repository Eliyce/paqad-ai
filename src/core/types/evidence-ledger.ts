import type { AdapterType } from './adapter.js';
import type { ComplianceEvidenceStrength, ComplianceRelation } from './pack.js';
import type { GateSkipKind } from './verification.js';

export const EVIDENCE_LEDGER_SCHEMA_VERSION = 1 as const;

export type EvidenceEngine =
  'verification-gate' | 'quality-ratchet' | 'traceability' | 'pentest' | 'triage';

export type EvidenceVerdict = 'pass' | 'fail' | 'inconclusive' | 'blocked' | 'skipped';

export type EvidenceStrengthClass = 'deterministic' | 'llm-judged' | 'blocked';

export interface EvidenceLedgerRow {
  schema_version: number;
  ts: string;
  doc_type?: string;
  change?: string;
  session_id?: string;
  recorded_at?: string;
  engine: EvidenceEngine;
  code: string;
  subject_digest: string;
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  content_hash: string;
  detail?: string;
  skip_kind?: GateSkipKind;
}

export interface EvidenceFileDigest {
  name: string;
  sha256: string;
}

export const PAQAD_VSA_PREDICATE_TYPE =
  'https://paqad.ai/attestations/verification-summary/v1' as const;

export const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1' as const;

export interface GradedEvidenceSummary {
  deterministic: { pass: number; fail: number };
  llm_judged: { pass: number; fail: number };
  blocked: number;
  inconclusive: number;
}

export interface ChangeAuthorship {
  agent?: AdapterType;
  model?: string;
  provider?: string;
  model_id?: string;
  accepting_human?: { name?: string; email?: string };
  provenance: 'declared' | 'unknown';
}

export interface ComplianceCitation {
  framework_id: string;
  framework_title: string;
  framework_version?: string;
  clause_id: string;
  clause_title: string;
  clause_url?: string;
  gate: string;
  relation: ComplianceRelation;
  evidence_strength: ComplianceEvidenceStrength;
  disclaimer: string;
}

export interface ReproducibilityStampPredicate {
  context_hash: string;
  determinism: 'input-replay';
  algo_version: number;
  replayable: boolean;
}

export interface VsaPredicate {
  verifier: { id: string; version: string };
  time_verified: string;
  policy: { predicate_type: typeof PAQAD_VSA_PREDICATE_TYPE; schema_version: number };
  verification_result: 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
  graded_results: GradedEvidenceSummary;
  evidence_by_engine: Partial<Record<EvidenceEngine, number>>;
  change_authorship?: ChangeAuthorship;
  compliance_citations?: ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
  metrics?: MetricsPredicate;
  rows?: EvidenceLedgerRow[];
  evidence_sha256?: string;
  evidence_line_count?: number;
}

export interface EvidenceSeal {
  sha256: string;
  line_count: number;
}

export interface MetricsPredicate {
  dup_new_pct: number | null;
  reuse_rate: number | null;
  meaningful_changed_lines: number;
}

export interface InTotoSubject {
  name: string;
  digest: { sha256: string };
}

export interface InTotoStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: InTotoSubject[];
  predicateType: typeof PAQAD_VSA_PREDICATE_TYPE;
  predicate: VsaPredicate;
}

export type ReceiptSigningMode = 'sigstore-keyless' | 'hash-chained';

export interface DsseSignature {
  keyid: string;
  sig: string;
}

export interface ReceiptEnvelope {
  payloadType: string;
  payload: string;
  signatures: DsseSignature[];
  paqad: {
    schema_version?: number;
    doc_type?: string;
    change?: string;
    session_id?: string;
    recorded_at?: string;
    content_hash?: string;
    signing_mode: ReceiptSigningMode;
    prev_receipt_hash: string;
    receipt_hash: string;
  };
}
