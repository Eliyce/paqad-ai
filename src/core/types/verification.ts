import type { StructuredTestResult } from './test-output.js';
import type { Lane } from './routing.js';
import type { MutationResult } from './mutation.js';
import type { QualityRatchetResult } from './quality-ratchet.js';

export const VERIFICATION_GATES = [
  'change-completeness',
  'requirement-completeness',
  'story-quality',
  'ac-test-mapping',
  'spec-review',
  'architecture-compliance',
  'code-tests-lint',
  'implementation-review',
  'behavioral-correctness',
  'mutation-testing',
  'quality-ratchet',
  'database-quality',
  'module-docs-structure',
  'instructions-docs-structure',
  'documentation-freshness',
  'site-map-freshness',
  'extension-surface',
  'duplication',
] as const;
export type VerificationGate = (typeof VERIFICATION_GATES)[number];

export const LATE_GATES = [
  'stage-evidence',
  'bundle-completeness',
  'evidence-existence',
  'visual-evidence',
  'rules-loaded',
  'fix-proof',
  'unrecorded-mandatory-stages',
] as const;
export type LateGate = (typeof LATE_GATES)[number];

export type GateCode = VerificationGate | LateGate;

export type GateStrength = 'deterministic' | 'llm-judged';

export type GateBackstopSource = 'runner' | 'checks-report' | 'late' | 'none';

export type GateOwner = 'work' | 'paqad-record';

interface GateBaseEntry {
  stage: string;
  lanes: readonly Lane[];
  strength: GateStrength;
  backstop: GateBackstopSource;
  default_runner: boolean;
  label: string;
}

export interface GateCatalogEntry extends GateBaseEntry {
  owner: GateOwner;
  records?: string;
}

const EVERY_LANE: readonly Lane[] = ['fast', 'graduated', 'full'];
const STAGED_LANES: readonly Lane[] = ['graduated', 'full'];

function entry(
  stage: string,
  strength: GateStrength,
  backstop: GateBackstopSource,
  label: string,
  defaultRunner = backstop !== 'late',
): GateBaseEntry {
  const lanes =
    stage === 'specification' || stage === 'review' || stage === 'documentation_sync'
      ? STAGED_LANES
      : EVERY_LANE;
  return { stage, lanes, strength, backstop, default_runner: defaultRunner, label };
}

const GATE_ENTRIES: Readonly<Record<GateCode, GateBaseEntry>> = {
  'change-completeness': entry('development', 'deterministic', 'runner', 'Nothing left half done'),
  'requirement-completeness': entry(
    'specification',
    'llm-judged',
    'none',
    'Every requirement is complete',
  ),
  'story-quality': entry('specification', 'llm-judged', 'none', 'The stories are well formed'),
  'ac-test-mapping': entry('checks', 'deterministic', 'runner', 'Every criterion has a test'),
  'spec-review': entry('specification', 'llm-judged', 'runner', 'The spec was reviewed'),
  'architecture-compliance': entry(
    'development',
    'deterministic',
    'none',
    'The architecture rules hold',
  ),
  'code-tests-lint': entry(
    'checks',
    'deterministic',
    'checks-report',
    'Tests, types and lint pass',
  ),
  'implementation-review': entry('review', 'llm-judged', 'runner', 'The code was reviewed'),
  'behavioral-correctness': entry(
    'checks',
    'deterministic',
    'none',
    'The behaviour matches the spec',
  ),
  'mutation-testing': entry('checks', 'deterministic', 'runner', 'Tests catch real mutations'),
  'quality-ratchet': entry('checks', 'deterministic', 'runner', 'Quality did not drop'),
  'database-quality': entry('development', 'deterministic', 'none', 'Database changes are safe'),
  'module-docs-structure': entry(
    'documentation_sync',
    'deterministic',
    'runner',
    'Module docs keep their shape',
  ),
  'instructions-docs-structure': entry(
    'documentation_sync',
    'deterministic',
    'runner',
    'Instruction docs keep their shape',
  ),
  'documentation-freshness': entry(
    'documentation_sync',
    'deterministic',
    'runner',
    'Docs match the code',
  ),
  'site-map-freshness': entry(
    'documentation_sync',
    'deterministic',
    'none',
    'The site map matches the app',
  ),
  'extension-surface': entry(
    'development',
    'deterministic',
    'runner',
    'Public surface stays stable',
  ),
  duplication: entry('development', 'deterministic', 'runner', 'No near-copies added', false),
  'stage-evidence': entry('checks', 'deterministic', 'late', 'Every stage was recorded'),
  'bundle-completeness': entry(
    'checks',
    'deterministic',
    'late',
    'The evidence bundle is complete',
  ),
  'evidence-existence': entry('checks', 'deterministic', 'late', 'The evidence files exist'),
  'visual-evidence': entry('checks', 'deterministic', 'late', 'The screens were captured'),
  'rules-loaded': entry('checks', 'deterministic', 'late', 'The rules were loaded'),
  'fix-proof': entry('development', 'deterministic', 'late', 'The fix is proven by a test'),
  'unrecorded-mandatory-stages': entry(
    'checks',
    'deterministic',
    'late',
    'Every mandatory stage has evidence',
  ),
};

const PAQAD_RECORDS: Readonly<Partial<Record<GateCode, string>>> = {
  'stage-evidence': 'every stage of this change',
  'bundle-completeness': 'the full evidence bundle',
  'unrecorded-mandatory-stages': 'evidence for every mandatory stage',
  'rules-loaded': 'that the rules were loaded',
  'evidence-existence': 'every evidence file',
  'fix-proof': 'the proof for this fix',
};

export const GATE_CATALOG: Readonly<Record<GateCode, GateCatalogEntry>> = Object.fromEntries(
  Object.entries(GATE_ENTRIES).map(([code, base]) => {
    const records = PAQAD_RECORDS[code as GateCode];
    const owned: GateCatalogEntry = records
      ? { ...base, owner: 'paqad-record', records }
      : { ...base, owner: 'work' };
    return [code, owned];
  }),
) as Record<GateCode, GateCatalogEntry>;

export function gateOwner(code: string): GateOwner {
  return gateCatalogEntry(code)?.owner ?? 'work';
}

export function recordGapText(code: string): string {
  return `paqad could not record ${gateCatalogEntry(code)?.records ?? code}`;
}

export function gateCatalogEntry(code: string): GateCatalogEntry | null {
  return Object.hasOwn(GATE_CATALOG, code) ? GATE_CATALOG[code as GateCode] : null;
}

export function gateExpectedOnLane(code: string, lane: string | null | undefined): boolean {
  const found = gateCatalogEntry(code);
  if (!found || !lane || !(EVERY_LANE as readonly string[]).includes(lane)) return true;
  return found.lanes.includes(lane as Lane);
}

export type GateSkipKind = 'not-required' | 'did-not-run';

export interface GateResult {
  gate: VerificationGate;
  passed: boolean;
  inconclusive?: boolean;
  outcome?: GateSkipKind;
  skip_reason?: string;
  detail: string;
  remediation?: string;
}

export interface ImplementationReviewFinding {
  kind: 'decision-violation' | 'undeclared-decision';
  severity: 'error' | 'warning';
  detail: string;
  decision_id?: string;
  file?: string;
}

export interface WaitingDecision {
  decision_id: string;
  category: string;
  question: string;
}

export type CanonicalDocOwnershipKind = 'direct-doc-edit' | 'implementation-drift';

export interface CanonicalDocTarget {
  target_path: string;
  ownership_kind: CanonicalDocOwnershipKind;
  owners: string[];
  reason: string;
}

export type VerificationOrigin =
  | 'provider-workflow'
  | 'paqad-cli'
  | 'hook-completion'
  | 'git-backstop'
  | 'ci-backstop'
  | 'unknown';

export const BACKSTOP_VERIFICATION_ORIGINS = [
  'hook-completion',
  'git-backstop',
  'ci-backstop',
] as const satisfies readonly VerificationOrigin[];

export function isBackstopVerificationOrigin(
  origin: VerificationOrigin | undefined,
): origin is (typeof BACKSTOP_VERIFICATION_ORIGINS)[number] {
  return (
    origin !== undefined && (BACKSTOP_VERIFICATION_ORIGINS as readonly string[]).includes(origin)
  );
}

export interface VerificationContext {
  project_root: string;
  verification_origin?: VerificationOrigin;
  verification_stage?: 'provider-completion' | 'backstop-completion' | 'other';
  modules: string[];
  changed_files: string[];
  changed_files_source: 'git' | 'none';
  spec_boundary?: string[];
  code_changed: boolean;
  test_files_changed: boolean;
  documentation_files_changed: boolean;
  stale_doc_targets: CanonicalDocTarget[];
  requirements_complete?: boolean;
  story_quality_passed?: boolean;
  ac_test_mapping_passed: boolean;
  ac_test_mapping_detail?: string;
  ac_test_mapping_outcome?: 'pass' | 'fail' | 'not-required' | 'did-not-run';
  spec_review_passed: boolean;
  spec_review_inconclusive?: boolean;
  spec_review_detail?: string;
  architecture_compliant?: boolean;
  code_tests_lint_passed?: boolean;
  implementation_review_passed: boolean;
  implementation_review_findings?: ImplementationReviewFinding[];
  waiting_decisions?: WaitingDecision[];
  behavioral_correctness_passed?: boolean;
  database_quality_passed?: boolean;
  structured_test_results?: StructuredTestResult[];
  mutation_result?: MutationResult;
  mutation_note?: string;
  mutation_strict?: boolean;
  quality_ratchet_result?: QualityRatchetResult;
  lane?: Lane;
  expected_ui_modules: string[];
  expected_api_modules: string[];
  expected_integration_modules: string[];
  expected_error_catalog_modules: string[];
  registry_refreshed_at: string | null;
  glossary_updated: boolean;
}
