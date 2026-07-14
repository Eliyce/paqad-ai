// The orchestrator: gather raw inputs through an injectable HealthGatherer,
// assemble the report (pure), and dual-write the outputs. Tests drive the whole
// run offline with a fake gatherer; the production gatherer (real shell-outs) is
// `createHealthGatherer` in ./gatherer.ts (excluded from coverage, like pentest).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { OsvVulnerabilityRecord } from '@/pentest/osv.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type {
  HealthBlockedCheck,
  HealthToolStatus,
  HealthWorkflowName,
} from '@/core/types/codebase-health.js';

import { assembleHealthReport } from './assemble.js';
import { readBaseline, writeBaseline } from './baseline.js';
import { createHealthGatherer } from './gatherer.js';
import { recordHealthRun } from './ledger.js';
import { buildHealthMarkdown } from './report-builder.js';
import { writeJsonFile } from './shared.js';
import type {
  DeprecationRecord,
  DuplicationCluster,
  SecretMatch,
  StaleDocCandidate,
} from './detectors.js';

/** Everything the run needs from the outside world — injected for tests. */
export interface HealthGatherer {
  availability(): HealthToolStatus[];
  stack(): Promise<{ primary: string; traits: string[]; toolchains: string[] }>;
  loadIndex(): CodeKnowledgeIndex | null;
  vulnerabilities(
    offline: boolean,
  ): Promise<{ records: OsvVulnerabilityRecord[]; blocked: HealthBlockedCheck[] }>;
  secrets(): Promise<{ matches: SecretMatch[] }>;
  duplication(): Promise<{ clusters: DuplicationCluster[]; blocked: HealthBlockedCheck[] }>;
  deprecations(
    offline: boolean,
  ): Promise<{ records: DeprecationRecord[]; blocked: HealthBlockedCheck[] }>;
  staleDocs(): Promise<StaleDocCandidate[]>;
}

export interface HealthRunOptions {
  projectRoot: string;
  offline?: boolean;
  workflow?: HealthWorkflowName;
  sourceReportPath?: string | null;
  sourceReportId?: string | null;
  now?: () => Date;
  gatherer?: HealthGatherer;
}

export interface HealthRunResult {
  report_id: string;
  report_path: string;
  sidecar_path: string;
  finding_count: number;
  blocked_checks: HealthBlockedCheck[];
  baseline_created: boolean;
  /** 0 clean · 1 findings · (2 is reserved for the CLI on an unexpected error). */
  exit_code: 0 | 1;
}

/** Run the full audit and dual-write the report. */
export async function runHealthAudit(options: HealthRunOptions): Promise<HealthRunResult> {
  const { projectRoot } = options;
  const offline = options.offline ?? false;
  const workflow = options.workflow ?? 'codebase-health';
  const now = options.now ?? (() => new Date());
  const gatherer = options.gatherer ?? createHealthGatherer(projectRoot);

  const index = gatherer.loadIndex();
  const blockedChecks: HealthBlockedCheck[] = [];
  if (!index) {
    blockedChecks.push({
      check: 'dead-code, unused-dependency',
      reason: 'the code-knowledge index has not been built',
      install_hint: 'Run `paqad-ai index build` first.',
    });
  }

  const [stack, vulns, secrets, duplication, deprecations, staleDocCandidates] = await Promise.all([
    gatherer.stack(),
    gatherer.vulnerabilities(offline),
    gatherer.secrets(),
    gatherer.duplication(),
    gatherer.deprecations(offline),
    gatherer.staleDocs(),
  ]);

  blockedChecks.push(...vulns.blocked, ...duplication.blocked, ...deprecations.blocked);

  const baseline = readBaseline(projectRoot);
  const { report, findingIds } = assembleHealthReport({
    workflow,
    now: now(),
    offline,
    stack,
    availability: gatherer.availability(),
    index,
    vulnRecords: vulns.records,
    secretMatches: secrets.matches,
    duplicationClusters: duplication.clusters,
    deprecationRecords: deprecations.records,
    staleDocCandidates,
    blockedChecks,
    baseline,
    sourceReportPath: options.sourceReportPath ?? null,
    sourceReportId: options.sourceReportId ?? null,
  });

  await writeJsonFile(join(projectRoot, report.sidecar_path), report);
  await writeMarkdown(join(projectRoot, report.report_path), buildHealthMarkdown(report));
  await writeJsonFile(
    join(projectRoot, PATHS.HEALTH_RUNS_DIR, report.report_id, 'finding-index.json'),
    { report_id: report.report_id, findings: report.findings },
  );

  let baselineCreated = false;
  if (baseline === null) {
    await writeBaseline(projectRoot, findingIds, now());
    baselineCreated = true;
  }

  recordHealthRun(projectRoot, {
    report_id: report.report_id,
    workflow: report.workflow,
    offline,
    finding_count: report.findings.length,
    blocked_count: report.blocked_checks.length,
    new_since_baseline: report.baseline.new_since_baseline,
    pre_existing: report.baseline.pre_existing,
  });

  return {
    report_id: report.report_id,
    report_path: report.report_path,
    sidecar_path: report.sidecar_path,
    finding_count: report.findings.length,
    blocked_checks: report.blocked_checks,
    baseline_created: baselineCreated,
    exit_code: report.findings.length > 0 ? 1 : 0,
  };
}

async function writeMarkdown(target: string, markdown: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markdown);
}

export { createHealthGatherer } from './gatherer.js';
