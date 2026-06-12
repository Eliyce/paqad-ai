export type PackInstallSource = 'built-in' | 'global' | 'project';

export interface StackPackTraitManifest {
  name: string;
  display_name: string;
  detect_package?: string;
  detect_file?: string;
  detect_directory?: string;
  description: string;
}

export interface StackPackFieldRule {
  name: string;
  presence?: 'required' | 'absent';
  value?: unknown;
}

export interface StackPackDetectionRule {
  file?: string;
  packages?: string[];
  patterns?: string[];
  directory?: string;
  content_match?: string;
  fields?: StackPackFieldRule[];
  field_absent?: string[];
}

export interface StackPackToolchainManifest {
  ecosystem: string;
  package_managers: string[];
  lockfiles: string[];
  audit_command?: string;
}

export interface StackPackMcpDefault {
  name: string;
  when: 'always' | 'when_trait';
  trait?: string;
}

export interface StackPackPentestCheckMap {
  glob: string;
  checks: string[];
}

export interface StackPackAuditCommand {
  command: string;
  parser: string;
}

export interface StackPackAstManifest {
  language: string;
  tree_sitter_grammar: string;
  file_extensions: string[];
}

export interface StackPackTestingFramework {
  name: string;
  detect_package?: string;
  detect_file?: string;
  run_command?: string;
}

export const STRUCTURED_TEST_FORMATS = [
  'jest-json',
  'junit-xml',
  'pytest-json',
  'go-json',
  'rspec-json',
  'tap',
  'none',
] as const;
export type StructuredTestFormat = (typeof STRUCTURED_TEST_FORMATS)[number];

export const TEST_RUNNER_OUTPUT_SOURCES = ['stdout', 'file'] as const;
export type TestRunnerOutputSource = (typeof TEST_RUNNER_OUTPUT_SOURCES)[number];

export interface StackPackTestRunner {
  runner_id: string;
  structured_format: StructuredTestFormat;
  structured_flags?: string;
  default_command?: string;
  output_source?: TestRunnerOutputSource;
  output_path_pattern?: string;
}

export interface StackPackDocsManifest {
  overview_template?: string;
  conventions_template?: string;
}

export interface StackPackRagManifest {
  exclude_directories?: string[];
  basename_includes?: string[];
}

// Issue #80, Phase 2/3. Reconciler reads source_roots; rollup reads the rest.
// Every shipped pack should declare this in Phase 3. When absent, the
// reconciler hard-fails with `blocked: source_roots_unknown` (spec AC #17).
export interface StackPackModuleHealthManifest {
  source_roots: string[];
  source_globs?: string[];
  public_api_extractor?: string | null;
  test_command?: string;
  coverage_format?: string;
  coverage_path?: string;
  test_report_format?: string;
  test_report_path?: string;
  // Optional override for the 14-day git activity window.
  git_window_days?: number;
}

export interface StackPackManifest {
  name: string;
  display_name: string;
  ecosystem: string;
  version: string;
  description: string;
  maintainer: string;
  tier?: 'framework' | 'archetype';
  detection: {
    manifests?: StackPackDetectionRule[];
    lockfiles?: StackPackDetectionRule[];
    heuristics?: StackPackDetectionRule[];
    priority?: number;
    excludes?: string[];
  };
  traits?: StackPackTraitManifest[];
  toolchains?: StackPackToolchainManifest[];
  mcp_defaults?: StackPackMcpDefault[];
  pentest?: {
    file_check_map?: StackPackPentestCheckMap[];
    audit_commands?: StackPackAuditCommand[];
  };
  ast?: StackPackAstManifest;
  testing?: {
    frameworks?: StackPackTestingFramework[];
  };
  test_runners?: StackPackTestRunner[];
  docs?: StackPackDocsManifest;
  rag?: StackPackRagManifest;
  module_health?: StackPackModuleHealthManifest;
}

// --- Compliance packs (issue #122) ------------------------------------------
//
// A second, deliberately minimal pack *kind* that carries NO stack-detection
// fields — only a framework header and a set of `clause → verification signal`
// mappings. It lets the community author honest `gate → legal clause` edges
// (e.g. `behavioral-correctness → EU AI Act Art. 15`) so a passing gate on the
// #118 receipt can cite *which* clause it produces evidence toward. It never
// asserts compliance — only *evidence toward* a clause.

/**
 * OSCAL Control-Mapping set-theory relations
 * (https://pages.nist.gov/OSCAL/learn/concepts/layer/control/mapping/). A gate
 * is almost always a `subset-of` or `intersects-with` a legal clause — rarely
 * `equivalent-to`. Using the honest relation is the whole point: a mis-mapped
 * `equivalent-to` manufactures false assurance.
 */
export const COMPLIANCE_RELATIONS = [
  'equivalent-to',
  'equal-to',
  'subset-of',
  'superset-of',
  'intersects-with',
  'no-relationship',
] as const;
export type ComplianceRelation = (typeof COMPLIANCE_RELATIONS)[number];

/** How strongly a clause's evidence is established. Never `full` — paqad does
 *  not perform conformity assessment, so a clause is at most `substantial`. */
export const COMPLIANCE_EVIDENCE_STRENGTHS = ['partial', 'substantial'] as const;
export type ComplianceEvidenceStrength = (typeof COMPLIANCE_EVIDENCE_STRENGTHS)[number];

/** What a clause is satisfied *by*: a verification gate or an obligation
 *  category. `gate` is the primary, deterministic join key. */
export type ComplianceSignalType = 'gate' | 'obligation_category';

export interface ComplianceClause {
  id: string;
  title: string;
  url?: string;
}

export interface ComplianceSignal {
  type: ComplianceSignalType;
  /** A `VERIFICATION_GATES` name (when `type: gate`) or an obligation category. */
  ref: string;
  relation: ComplianceRelation;
}

export interface ComplianceMapping {
  clause: ComplianceClause;
  satisfied_by: ComplianceSignal[];
  evidence_strength: ComplianceEvidenceStrength;
  /** Provenance of the human/process that authored this opinion edge. */
  reviewed_by?: string;
}

export interface ComplianceFramework {
  id: string;
  title: string;
  authority_url?: string;
  /** Standards amend live; pin the version so stale citations are detectable. */
  version?: string;
}

export interface CompliancePackManifest {
  /** Discriminator selecting the `compliance-pack` schema. */
  kind: 'compliance-pack';
  name: string;
  description?: string;
  maintainer?: string;
  framework: ComplianceFramework;
  /** Verbatim, surfaced on every citation: evidence toward, not compliance. */
  disclaimer: string;
  mappings: ComplianceMapping[];
}

export interface LoadedCompliancePack {
  manifest: CompliancePackManifest;
  root: string;
  manifestPath: string;
  source: PackInstallSource;
  validation: PackValidationResult;
}

export interface CompliancePackRegistry {
  packs: Map<string, LoadedCompliancePack>;
  warnings: PackValidationIssue[];
}

export interface PackValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface PackValidationResult {
  valid: boolean;
  issues: PackValidationIssue[];
}

export interface LoadedStackPack {
  manifest: StackPackManifest;
  root: string;
  manifestPath: string;
  source: PackInstallSource;
  validation: PackValidationResult;
}

export interface PackRegistry {
  packs: Map<string, LoadedStackPack>;
  warnings: PackValidationIssue[];
}
