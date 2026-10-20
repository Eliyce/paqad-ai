export const TRIAGE_PILES = ['confirmed', 'unclear-spec', 'false-alarm', 'taste'] as const;
export type TriagePile = (typeof TRIAGE_PILES)[number];

export const TRIAGE_FINDING_SOURCES = [
  'gate',
  'gap-detector',
  'adversarial-reviewer',
  'final-reviewer',
  'spec-review',
] as const;
export type TriageFindingSource = (typeof TRIAGE_FINDING_SOURCES)[number];

export const TRIAGE_ROUTES = [
  'code-change',
  'await-repro',
  'spec',
  'record',
  'ratchet',
  'ask-human',
] as const;
export type TriageRoute = (typeof TRIAGE_ROUTES)[number];

export const TRIAGE_CONFIRMATIONS = ['demonstrable', 'needs-repro'] as const;
export type TriageConfirmation = (typeof TRIAGE_CONFIRMATIONS)[number];

export interface TriageSignals {
  gate_failed?: boolean;
  reproducible?: boolean;
  behavioural?: boolean;
  spec_silent?: boolean;
  style_only?: boolean;
  measurable_quality?: boolean;
  refuted_by_evidence?: boolean;
}

export interface TriageFinding {
  id: string;
  source: TriageFindingSource;
  kind: string;
  message: string;
  file?: string | null;
  line?: number | null;
  signals: TriageSignals;
}

export interface TriageVerdict {
  finding_id: string;
  pile: TriagePile | null;
  ambiguous: boolean;
  confirmation?: TriageConfirmation;
  route: TriageRoute;
  reason: string;
}

export const TRIAGE_LEDGER_SCHEMA_VERSION = '1.0.0' as const;

export interface TriageLedgerEntry {
  finding_id: string;
  source: TriageFindingSource;
  kind: string;
  pile: TriagePile | null;
  route: TriageRoute;
  confirmation?: TriageConfirmation;
  reason: string;
  file?: string | null;
  line?: number | null;
  recorded_at: string;
}

export interface TriageLedger {
  schema_version: typeof TRIAGE_LEDGER_SCHEMA_VERSION;
  updated_at: string;
  entries: TriageLedgerEntry[];
}
