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

export const TEST_RUNNER_PARALLEL_MODES = ['native', 'flag', 'unavailable'] as const;
export type TestRunnerParallelMode = (typeof TEST_RUNNER_PARALLEL_MODES)[number];

export const SINGLE_TEST_SELECTORS = ['test_id', 'file'] as const;
export type SingleTestSelector = (typeof SINGLE_TEST_SELECTORS)[number];

export interface StackPackTestRunnerParallel {
  mode: TestRunnerParallelMode;
  flag?: string;
  requires_package?: string;
  reason?: string;
}

export interface StackPackTestRunner {
  runner_id: string;
  structured_format: StructuredTestFormat;
  structured_flags?: string;
  default_command?: string;
  output_source?: TestRunnerOutputSource;
  output_path_pattern?: string;
  parallel?: StackPackTestRunnerParallel;
  single_test_selector?: SingleTestSelector;
}

export interface StackPackDocsManifest {
  overview_template?: string;
  conventions_template?: string;
}

export interface StackPackRagManifest {
  exclude_directories?: string[];
  basename_includes?: string[];
}

export interface StackPackModuleHealthManifest {
  source_roots: string[];
  source_globs?: string[];
  public_api_extractor?: string | null;
  test_command?: string;
  coverage_format?: string;
  coverage_path?: string;
  test_report_format?: string;
  test_report_path?: string;
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
  visual_evidence?: {
    frontend_globs?: string[];
  };
}

export const COMPLIANCE_RELATIONS = [
  'equivalent-to',
  'equal-to',
  'subset-of',
  'superset-of',
  'intersects-with',
  'no-relationship',
] as const;
export type ComplianceRelation = (typeof COMPLIANCE_RELATIONS)[number];

export const COMPLIANCE_EVIDENCE_STRENGTHS = ['partial', 'substantial'] as const;
export type ComplianceEvidenceStrength = (typeof COMPLIANCE_EVIDENCE_STRENGTHS)[number];

export type ComplianceSignalType = 'gate' | 'obligation_category';

export interface ComplianceClause {
  id: string;
  title: string;
  url?: string;
}

export interface ComplianceSignal {
  type: ComplianceSignalType;
  ref: string;
  relation: ComplianceRelation;
}

export interface ComplianceMapping {
  clause: ComplianceClause;
  satisfied_by: ComplianceSignal[];
  evidence_strength: ComplianceEvidenceStrength;
  reviewed_by?: string;
}

export interface ComplianceFramework {
  id: string;
  title: string;
  authority_url?: string;
  version?: string;
}

export interface CompliancePackManifest {
  kind: 'compliance-pack';
  name: string;
  description?: string;
  maintainer?: string;
  framework: ComplianceFramework;
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
