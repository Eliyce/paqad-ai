// Pure report assembly: given every gathered raw input, run the detectors, assign
// stable ids, apply the baseline ratchet, and produce the HealthReportIndex. No
// I/O — the impure collector in `run.ts` gathers the inputs and writes the outputs.

import { join } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type { OsvVulnerabilityRecord } from '@/pentest/osv.js';
import type {
  HealthBaseline,
  HealthFinding,
  HealthReportIndex,
  HealthToolStatus,
  HealthWorkflowName,
  HealthBlockedCheck,
} from '@/core/types/codebase-health.js';

import { applyBaselineStatus } from './baseline.js';
import {
  detectAiSlop,
  detectDeadCode,
  detectDeprecatedDependencies,
  detectDuplication,
  detectSecrets,
  detectStaleDocs,
  detectUnusedDependencies,
  detectVulnerableDependencies,
  type DeprecationRecord,
  type DuplicationCluster,
  type HealthCandidate,
  type SecretMatch,
  type StaleDocCandidate,
} from './detectors.js';
import { nextRemediationPriorities } from './report-builder.js';
import {
  assignHealthFindingIds,
  sortFindings,
  toHealthReportId,
  toHealthTimestamp,
} from './shared.js';

export interface HealthAssemblyInput {
  workflow: HealthWorkflowName;
  now: Date;
  offline: boolean;
  stack: { primary: string; traits: string[]; toolchains: string[] };
  availability: HealthToolStatus[];
  index: CodeKnowledgeIndex | null;
  vulnRecords: OsvVulnerabilityRecord[];
  secretMatches: SecretMatch[];
  duplicationClusters: DuplicationCluster[];
  deprecationRecords: DeprecationRecord[];
  staleDocCandidates: StaleDocCandidate[];
  blockedChecks: HealthBlockedCheck[];
  baseline: HealthBaseline | null;
  sourceReportPath?: string | null;
  sourceReportId?: string | null;
  sourcesUsed?: string[];
}

export interface AssembledHealthReport {
  report: HealthReportIndex;
  findings: HealthFinding[];
  findingIds: string[];
}

/** Concatenate every category's candidates in a stable, category-ordered sequence. */
function collectCandidates(input: HealthAssemblyInput): HealthCandidate[] {
  const candidates: HealthCandidate[] = [];
  if (input.index) {
    candidates.push(...detectUnusedDependencies(input.index));
    candidates.push(...detectDeadCode(input.index));
  }
  candidates.push(...detectVulnerableDependencies(input.vulnRecords));
  candidates.push(...detectDeprecatedDependencies(input.deprecationRecords));
  candidates.push(...detectSecrets(input.secretMatches));
  candidates.push(...detectDuplication(input.duplicationClusters));
  candidates.push(...detectStaleDocs(input.staleDocCandidates));
  candidates.push(...detectAiSlop(input.duplicationClusters, input.index));
  return candidates;
}

/** Assemble the full report index from gathered inputs (pure). */
export function assembleHealthReport(input: HealthAssemblyInput): AssembledHealthReport {
  const withIds = assignHealthFindingIds(collectCandidates(input));
  const findings = sortFindings(applyBaselineStatus(withIds, input.baseline));

  const timestamp = toHealthTimestamp(input.now);
  const isRetest = input.workflow === 'health-retest';
  const base =
    isRetest && input.sourceReportId
      ? `${stripReportPrefix(input.sourceReportId)}-retest-${timestamp}`
      : timestamp;
  const reportPath = toPosixPath(join(PATHS.HEALTH_DIR, `${base}.md`));
  const sidecarPath = toPosixPath(join(PATHS.HEALTH_DIR, `${base}.json`));

  const newSinceBaseline = findings.filter(
    (finding) => finding.baseline_status === 'new-since-baseline',
  ).length;
  const preExisting = findings.filter(
    (finding) => finding.baseline_status === 'pre-existing',
  ).length;

  const report: HealthReportIndex = {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    report_id: toHealthReportId(isRetest ? 'RETEST' : 'HEALTH', input.now),
    workflow: input.workflow,
    generated_at: input.now.toISOString(),
    report_path: reportPath,
    sidecar_path: sidecarPath,
    source_report_path: input.sourceReportPath ?? null,
    source_report_id: input.sourceReportId ?? null,
    offline: input.offline,
    stack: input.stack,
    tool_availability: input.availability,
    findings,
    blocked_checks: input.blockedChecks,
    baseline: {
      existed: input.baseline !== null,
      new_since_baseline: newSinceBaseline,
      pre_existing: preExisting,
    },
    sources_used: input.sourcesUsed ?? deriveSourcesUsed(input),
    next_remediation_priorities: nextRemediationPriorities(findings),
    raw_evidence_paths: [],
  };

  return { report, findings, findingIds: findings.map((finding) => finding.id) };
}

function stripReportPrefix(reportId: string): string {
  return reportId.replace(/^(?:HEALTH|RETEST)-/, '');
}

function deriveSourcesUsed(input: HealthAssemblyInput): string[] {
  const sources = new Set<string>();
  if (input.index) sources.add('code-knowledge index');
  for (const tool of input.availability) {
    if (tool.available) sources.add(tool.tool);
  }
  if (input.secretMatches.some((match) => match.source === 'builtin-regex')) {
    sources.add('built-in regex secret scan');
  }
  return [...sources].sort();
}
