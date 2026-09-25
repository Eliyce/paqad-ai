// The declarative feature-bundle manifest (issue #511, part A).
//
// One source of truth that states, per bundle file, WHEN it is required (always, or a
// config predicate) and WHO writes it. Before this the expectation was implicit — spread
// across FEATURE_BUNDLE_FILES, the enterprise policy, the duplication/rule/metrics mode
// resolvers, and the evidence-existence gate's own hard-coded four-file list — so a file
// added in a future phase got no completeness check unless someone remembered to hand-wire
// one. That is exactly how feature.json and delivery.json shipped with no writer and no
// gate. The manifest closes that: the bundle-completeness gate reads THIS list, and a test
// asserts every FEATURE_BUNDLE_FILES key (plus report.html) has an entry here — so a new
// file cannot be added without declaring its expectation.

import { FEATURE_BUNDLE_FILES, type FeatureBundleFile } from './paths.js';

/** The resolved config flags a manifest `required` predicate reads. */
export interface BundleCompletenessConfig {
  /** rule_compliance mode !== 'off'. */
  ruleComplianceOn: boolean;
  /** metrics_enabled. */
  metricsEnabled: boolean;
  /** duplication_mode !== 'off'. */
  duplicationOn: boolean;
  /** feature_report. */
  featureReport: boolean;
  /** rag_enabled. */
  ragEnabled: boolean;
  /** enterprise master switch. */
  enterprise: boolean;
  /** enterprise_evidence_ledger (gates receipt.json; evidence.jsonl is always on since #581). */
  evidenceLedger: boolean;
  /** enterprise_ai_bom (gates ai-bom.json). */
  aiBom: boolean;
  /**
   * spec_pipeline_enabled && spec_pipeline_adoption === 'strict' (issue #547, FR-10.1). When on,
   * the specification file must record that the pipeline produced it, or a manual reason.
   */
  specPipelineStrict: boolean;
  /** spec_pipeline_enabled (issue #581): the pipeline writes request.md and clarification.json. */
  specPipelineEnabled: boolean;
  /**
   * spec_pipeline_experts_enabled (issue #581). Only counts together with
   * {@link specPipelineEnabled}: experts cannot run without the pipeline (M5, AC-21).
   */
  expertsEnabled: boolean;
  /**
   * Issue #573 — whether stage isolation was EXPECTED for this change: the recorded lane
   * is graduated or full AND the recorded host adapter can dispatch subagents. Derived
   * from the bundle's own open row, not from config, because whether isolation applied is
   * a property of the change. False on the fast lane, on a host with no subagent dispatch,
   * and whenever the lane is unresolved — so the requirement stays silent rather than
   * false-failing (INV-5). When true, the gate requires `stage-agent` rows in
   * `stage-evidence.jsonl` (issue #581, AC-14).
   */
  stageIsolationExpected: boolean;
}

/** How the gate proves a required file is not just present but real. */
export type BundleFileValidator =
  /** Parses as a JSON value. */
  | 'json'
  /** Has at least one non-blank line (a JSONL ledger). */
  | 'jsonl>=1'
  /** Has any bytes at all. */
  | 'nonempty';

/**
 * A manifest key: every {@link FeatureBundleFile} plus the derived `report.html`
 * projection (issue #371), which is not a member of {@link FEATURE_BUNDLE_FILES} but is
 * still an expected bundle output.
 */
export type BundleManifestKey = FeatureBundleFile | 'report';

/** One row of the bundle manifest. */
export interface BundleManifestEntry {
  /** The manifest key (a bundle-file key, or `report` for report.html). */
  key: BundleManifestKey;
  /** The on-disk filename inside the bundle dir. */
  file: string;
  /**
   * `'always'` (required in every change), `'optional'` (a known bundle file that is checked
   * when present but never required and never a "flag off" skip — issue #528), or a predicate
   * over the resolved config flags (required only when the flag is on).
   */
  required: 'always' | 'optional' | ((config: BundleCompletenessConfig) => boolean);
  /** The verb/writer that produces the file (named in a gate failure's remediation). */
  writer: string;
  /** How the gate validates the file's content. */
  validate: BundleFileValidator;
  /**
   * RAG-only: its retrieval is UNRECOVERABLE, so a genuine gap is reported inconclusive
   * (never a hard fail), and it may live in the session `_chat` home instead of the bundle
   * (the documented one-prompt lag). The gate special-cases the entries carrying this flag.
   */
  unrecoverable?: boolean;
}

/**
 * The bundle manifest — every file a finished feature-development change may leave, with
 * its required-when predicate, its writer, and its content check. Keyed so the coverage
 * test can assert it covers every {@link FEATURE_BUNDLE_FILES} key plus `report`.
 */
export const BUNDLE_MANIFEST: readonly BundleManifestEntry[] = [
  {
    key: 'feature',
    file: FEATURE_BUNDLE_FILES.feature,
    required: 'always',
    writer: 'feature mint (paqad-ai stage start / plan compile)',
    validate: 'json',
  },
  {
    key: 'plan',
    file: FEATURE_BUNDLE_FILES.plan,
    required: 'always',
    writer: 'paqad-ai plan compile',
    validate: 'json',
  },
  {
    key: 'specification',
    file: FEATURE_BUNDLE_FILES.specification,
    required: 'always',
    writer: 'paqad-ai spec freeze',
    validate: 'json',
  },
  {
    // Issue #581 (D5) — the signed spec source, beside the parsed record. The gate also checks
    // that its body hashes to specification.json `spec_hash`.
    key: 'specMd',
    file: FEATURE_BUNDLE_FILES.specMd,
    required: 'always',
    writer: 'paqad-ai spec freeze',
    validate: 'nonempty',
  },
  {
    key: 'request',
    file: FEATURE_BUNDLE_FILES.request,
    required: (config) => config.specPipelineEnabled,
    writer: 'paqad-ai spec pipeline start',
    validate: 'nonempty',
  },
  {
    key: 'clarification',
    file: FEATURE_BUNDLE_FILES.clarification,
    required: (config) => config.specPipelineEnabled,
    writer: 'paqad-ai spec pipeline (label + questions)',
    validate: 'json',
  },
  {
    // Experts only run inside the pipeline, so experts-on with the pipeline off (M5) never
    // requires the file (AC-21).
    key: 'experts',
    file: FEATURE_BUNDLE_FILES.experts,
    required: (config) => config.specPipelineEnabled && config.expertsEnabled,
    writer: 'paqad-ai spec pipeline experts',
    validate: 'json',
  },
  {
    // A change that resolved no decision has no index to write, so it is checked when present.
    key: 'decisions',
    file: FEATURE_BUNDLE_FILES.decisions,
    required: 'optional',
    writer: 'paqad-ai decision resolve (decisions index)',
    validate: 'json',
  },
  {
    key: 'review',
    file: FEATURE_BUNDLE_FILES.review,
    required: 'always',
    writer: 'paqad-ai review record',
    validate: 'json',
  },
  {
    key: 'stageEvidence',
    file: FEATURE_BUNDLE_FILES.stageEvidence,
    required: 'always',
    writer: 'stage recorder',
    validate: 'jsonl>=1',
  },
  {
    key: 'ruleRun',
    file: FEATURE_BUNDLE_FILES.ruleRun,
    required: (config) => config.ruleComplianceOn,
    writer: 'rule-scripts runner',
    validate: 'jsonl>=1',
  },
  {
    // Issue #557 — the rule-loading evidence. `optional`, not flag-gated: like checks.json and
    // visual-evidence.json its real enforcement is a dedicated gate (rulesLoadedGate), which has
    // the applicable-rules signal this content-only validator does not. Checked-when-present here
    // (a written record must be valid JSON) and never a "flag off" skip — rule-loading is
    // required, not tunable, so there is no flag to be off.
    key: 'rulesLoaded',
    file: FEATURE_BUNDLE_FILES.rulesLoaded,
    required: 'optional',
    writer: 'paqad-ai rules load',
    validate: 'json',
  },
  {
    key: 'delivery',
    file: FEATURE_BUNDLE_FILES.delivery,
    required: 'always',
    writer: 'feature open + paqad-ai delivery-link',
    validate: 'json',
  },
  {
    // Issue #528 — checks.json is re-homed into the bundle, so it must be a KNOWN bundle file
    // (covered by the manifest guard, allowed by the bundle-integrity guard). It is `optional`,
    // not flag-gated: the completeness gate has no signal for "were check commands mapped this
    // change?", so requiring it would false-fail a change that maps none — but it is NOT "flag
    // off" either (there is no flag), so it must not surface as a "Skipped (flag off)" note.
    // Checked when present, ignored when absent. Its real enforcement is the completion backstop
    // reading structured_test_results, not this gate.
    key: 'checks',
    file: FEATURE_BUNDLE_FILES.checks,
    required: 'optional',
    writer: 'paqad-ai checks run',
    validate: 'json',
  },
  {
    key: 'changeMetrics',
    file: FEATURE_BUNDLE_FILES.changeMetrics,
    required: (config) => config.metricsEnabled,
    writer: 'change-metrics collector',
    validate: 'jsonl>=1',
  },
  {
    key: 'duplication',
    file: FEATURE_BUNDLE_FILES.duplication,
    required: (config) => config.duplicationOn,
    writer: 'duplication scan',
    validate: 'jsonl>=1',
  },
  {
    key: 'report',
    file: 'report.html',
    required: (config) => config.featureReport,
    writer: 'feature report renderer (writeFeatureReport)',
    validate: 'nonempty',
  },
  {
    key: 'rag',
    file: FEATURE_BUNDLE_FILES.rag,
    required: (config) => config.ragEnabled,
    writer: 'RAG recorder',
    validate: 'jsonl>=1',
    unrecoverable: true,
  },
  {
    key: 'receipt',
    file: FEATURE_BUNDLE_FILES.receipt,
    required: (config) => config.enterprise && config.evidenceLedger,
    writer: 'projectFeatureReceipt',
    validate: 'json',
  },
  {
    // Issue #581 — always on: every change records one row per gate that ran, the late gates
    // and skipped ones included, whatever the enterprise toggles. Only the receipt that seals
    // it and the AI-BOM stay enterprise capabilities.
    key: 'evidence',
    file: FEATURE_BUNDLE_FILES.evidence,
    required: 'always',
    writer: 'appendFeatureEvidenceRows',
    validate: 'jsonl>=1',
  },
  {
    key: 'aiBom',
    file: FEATURE_BUNDLE_FILES.aiBom,
    required: (config) => config.enterprise && config.aiBom,
    writer: 'projectFeatureReceipt (AI-BOM)',
    validate: 'json',
  },
  {
    // Issue #551 — the visual-evidence manifest. `optional`, not flag-gated: the completeness
    // gate cannot see whether THIS change was frontend-triggering (that lives in the Part-F
    // gate), so requiring it would false-fail the flag-on / non-frontend / file-absent case.
    // Like checks.json it is checked-when-present here and NOT a "flag off" skip; the real
    // enforcement (existence on a frontend change + hash/size verification of every referenced
    // screenshot) is the VisualEvidenceGate, which has the bundle dir the content-only manifest
    // validator does not.
    key: 'visualEvidence',
    file: FEATURE_BUNDLE_FILES.visualEvidence,
    required: 'optional',
    writer: 'paqad-ai visual-evidence run',
    validate: 'json',
  },
];

/**
 * The strict-adoption content check for `specification.json` (issue #547, FR-10.2). When
 * `specPipelineStrict` is on, the frozen spec must carry `provenance.pipeline_produced === true`
 * or a non-empty `provenance.manual_reason`; otherwise the gate fails closed. Under warn or with
 * the pipeline off this is not called, so the gate is unchanged there. Pure: parses the JSON and
 * inspects the provenance field, importing nothing from the pipeline.
 */
export function validateSpecificationAdoption(content: string | null): {
  ok: boolean;
  error?: string;
} {
  const failure = {
    ok: false,
    error:
      'specification.json was not produced by the spec pipeline and records no manual reason (spec_pipeline_adoption=strict); re-freeze with --from-pipeline or --manual --reason',
  };
  if (content === null) return failure;
  let spec: { provenance?: { pipeline_produced?: unknown; manual_reason?: unknown } };
  try {
    spec = JSON.parse(content) as typeof spec;
  } catch {
    return failure;
  }
  const provenance = spec.provenance;
  if (!provenance) return failure;
  if (provenance.pipeline_produced === true) return { ok: true };
  if (typeof provenance.manual_reason === 'string' && provenance.manual_reason.trim().length > 0) {
    return { ok: true };
  }
  return failure;
}

/** Whether a manifest entry is required under the resolved config. */
export function isBundleFileRequired(
  entry: BundleManifestEntry,
  config: BundleCompletenessConfig,
): boolean {
  if (entry.required === 'always') return true;
  // `optional` files (issue #528) are never required — they are checked when present but never
  // gate a change on absence, and are not flag-gated.
  if (entry.required === 'optional') return false;
  return entry.required(config);
}

/** The manifest entries required under the resolved config (the gate's work list). */
export function requiredBundleFiles(config: BundleCompletenessConfig): BundleManifestEntry[] {
  return BUNDLE_MANIFEST.filter((entry) => isBundleFileRequired(entry, config));
}

/**
 * Validate a file's raw bytes against a {@link BundleFileValidator}. `null` bytes (the file
 * is absent/unreadable) always fail. `json` requires a parseable JSON value; `jsonl>=1`
 * requires at least one non-blank line; `nonempty` requires any content at all.
 */
export function validateBundleFileContent(
  validate: BundleFileValidator,
  content: string | null,
): boolean {
  if (content === null) {
    return false;
  }
  switch (validate) {
    case 'json':
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    case 'jsonl>=1':
      return content.split('\n').some((line) => line.trim().length > 0);
    case 'nonempty':
      return content.trim().length > 0;
  }
}
