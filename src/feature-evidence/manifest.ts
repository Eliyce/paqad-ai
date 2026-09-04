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
  /** enterprise_evidence_ledger (gates receipt.json + evidence.jsonl). */
  evidenceLedger: boolean;
  /** enterprise_ai_bom (gates ai-bom.json). */
  aiBom: boolean;
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
  /** `'always'`, or a predicate over the resolved config flags. */
  required: 'always' | ((config: BundleCompletenessConfig) => boolean);
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
    key: 'delivery',
    file: FEATURE_BUNDLE_FILES.delivery,
    required: 'always',
    writer: 'feature open + paqad-ai delivery-link',
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
    key: 'evidence',
    file: FEATURE_BUNDLE_FILES.evidence,
    required: (config) => config.enterprise && config.evidenceLedger,
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
];

/** Whether a manifest entry is required under the resolved config. */
export function isBundleFileRequired(
  entry: BundleManifestEntry,
  config: BundleCompletenessConfig,
): boolean {
  return entry.required === 'always' ? true : entry.required(config);
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
