// Issue #121 — the SIEM exporter: a read-only, local-first projection of the
// #118 evidence ledger + tamper-evident receipt chain into the schemas an
// enterprise's own SIEM already ingests (OCSF, ECS, CEF) plus a canonical JSONL
// passthrough. No paqad-hosted endpoint, no streaming control plane: paqad reads
// the on-disk ledger and writes a standard-format file/stream the customer's own
// collector (Splunk forwarder, rsyslog, Datadog agent, Filebeat) ships. Their
// backend, our data.

/** The target schemas `paqad-ai audit export` can emit. OCSF is the primary,
 *  vendor-neutral lingua franca; ECS and CEF cover Elastic and ArcSight/QRadar;
 *  jsonl is the canonical passthrough of the normalized event. */
export const SIEM_FORMATS = ['ocsf', 'ecs', 'cef', 'jsonl'] as const;
export type SiemFormat = (typeof SIEM_FORMATS)[number];

/** An evidence row records a graded verification verdict on a change; an
 *  attestation is a signed/hash-chained receipt over a change. */
export type SiemEventKind = 'evidence' | 'attestation';

/** A changed file attested by a receipt — an in-toto subject. */
export interface SiemSubject {
  /** Project-relative path. */
  name: string;
  /** SHA-256 hex of the file bytes (or the path string when unreadable). */
  sha256: string;
}

/** Issue #120 change-authorship, flattened for the exporter. `accepting_human`
 *  and free-text are the only PII the redaction pass removes. */
export interface SiemAuthorship {
  agent?: string;
  model?: string;
  provider?: string;
  model_id?: string;
  accepting_human?: { name?: string; email?: string };
  provenance?: string;
}

/**
 * The format-neutral internal event the aggregator produces and every formatter
 * consumes. Carries everything the #118 ledger and receipt chain already record
 * — verdict, the deterministic-vs-LLM-judged grade, the change subject digests,
 * the tamper-evident chain seal status, and the authorship — so the SIEM record
 * is structurally richer than a hosted log that omits local session context.
 */
export interface SiemEvent {
  kind: SiemEventKind;
  /** ISO-8601 emission time (ledger `ts`, or receipt `time_verified`). */
  ts: string;
  /** Which engine produced an evidence row (absent for attestations). */
  engine?: string;
  /** Gate name / finding code (e.g. `mutation-testing`), or `receipt`. */
  code: string;
  /** `pass`/`fail`/`inconclusive`/`blocked`, or `PASSED`/`FAILED` for a receipt. */
  verdict: string;
  /** SHA-256 identifying the change subject the row pertains to. */
  subject_digest?: string;
  /** The anti-theater grade: `deterministic` | `llm-judged` | `blocked`. */
  strength_class?: string;
  /** Row identity hash (evidence) or receipt hash (attestation) — a dedup key. */
  content_hash?: string;
  /** Human-readable detail. Redactable (may carry filenames / error strings). */
  detail?: string;

  // ── attestation-only ──────────────────────────────────────────────────────
  /** Position in the receipt chain (0 = genesis). */
  receipt_index?: number;
  receipt_hash?: string;
  prev_receipt_hash?: string;
  /** `hash-chained` locally, `sigstore-keyless` in CI with opt-in. */
  signing_mode?: string;
  /** Whether the hash chain recomputes cleanly up to and including this link. */
  sealed?: boolean;
  /** Changed files attested by the receipt. */
  subjects?: SiemSubject[];
  /** Who wrote and accepted the change. */
  authorship?: SiemAuthorship;
}

/** Options for one export run. `productVersion` is stamped into the OCSF/ECS/CEF
 *  product metadata so a SIEM can pin the producing paqad version. */
export interface ExportOptions {
  format: SiemFormat;
  /** Drop events strictly older than this ISO-8601 instant when set. */
  since?: string;
  /** Strip free-text detail and human identities when true. */
  redact?: boolean;
  /** paqad-ai version stamped into the emitted records. */
  productVersion: string;
}

export interface ExportResult {
  format: SiemFormat;
  /** Number of events emitted after filtering. */
  count: number;
  /** The serialized records, newline-separated, with NO trailing newline. */
  output: string;
}
