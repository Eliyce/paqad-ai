export const SIEM_FORMATS = ['ocsf', 'ecs', 'cef', 'jsonl'] as const;
export type SiemFormat = (typeof SIEM_FORMATS)[number];

export type SiemEventKind = 'evidence' | 'attestation' | 'session';

export interface SiemSubject {
  name: string;
  sha256: string;
}

export interface SiemAuthorship {
  agent?: string;
  model?: string;
  provider?: string;
  model_id?: string;
  accepting_human?: { name?: string; email?: string };
  provenance?: string;
}

export interface SiemEvent {
  kind: SiemEventKind;
  ts: string;
  engine?: string;
  code: string;
  verdict: string;
  subject_digest?: string;
  strength_class?: string;
  content_hash?: string;
  detail?: string;

  doc_type?: string;
  session_id?: string;

  receipt_index?: number;
  receipt_hash?: string;
  prev_receipt_hash?: string;
  signing_mode?: string;
  sealed?: boolean;
  subjects?: SiemSubject[];
  authorship?: SiemAuthorship;
}

export interface ExportOptions {
  format: SiemFormat;
  since?: string;
  redact?: boolean;
  productVersion: string;
}

export interface ExportResult {
  format: SiemFormat;
  count: number;
  output: string;
}
