// The impure orchestrator: gather raw inputs (index, shell-outs, git, network),
// assemble the report (pure), and dual-write the outputs. Every impurity flows
// through an injectable HealthGatherer so tests drive the whole run offline with
// fakes; the production gatherer is `createHealthGatherer`.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { queryOsv, type OsvVulnerabilityRecord } from '@/pentest/osv.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type { InstalledPackage } from '@/core/types/introspection.js';
import type {
  HealthBlockedCheck,
  HealthToolStatus,
  HealthWorkflowName,
} from '@/core/types/codebase-health.js';

import { assembleHealthReport } from './assemble.js';
import { readBaseline, writeBaseline } from './baseline.js';
import { recordHealthRun } from './ledger.js';
import { buildHealthMarkdown } from './report-builder.js';
import { writeJsonFile } from './shared.js';
import {
  HEALTH_TOOLS,
  healthToolSpec,
  isToolAvailable,
  resolveToolAvailability,
} from './tools.js';
import {
  builtinSecretScan,
  gatherStaleDocCandidates,
  parseGitleaksJson,
  parseJscpdJson,
  parseNpmAuditJson,
  parseOsvScannerJson,
  type DocTimestampInput,
} from './gather.js';
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
  vulnerabilities(offline: boolean): Promise<{ records: OsvVulnerabilityRecord[]; blocked: HealthBlockedCheck[] }>;
  secrets(): Promise<{ matches: SecretMatch[] }>;
  duplication(): Promise<{ clusters: DuplicationCluster[]; blocked: HealthBlockedCheck[] }>;
  deprecations(offline: boolean): Promise<{ records: DeprecationRecord[]; blocked: HealthBlockedCheck[] }>;
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

// --- production gatherer ---------------------------------------------------

/** Wire the real world: StackIntrospector, code-knowledge index, and shell-outs. */
export function createHealthGatherer(
  projectRoot: string,
  shell: DeliveryShell = createDeliveryShell(projectRoot),
): HealthGatherer {
  const availability = resolveToolAvailability();
  let packagesCache: InstalledPackage[] | null = null;

  async function packages(): Promise<InstalledPackage[]> {
    if (packagesCache) return packagesCache;
    const snapshot = await new StackIntrospector().snapshot(projectRoot, { persist: false });
    packagesCache = snapshot.packages;
    return packagesCache;
  }

  return {
    availability: () => availability,
    async stack() {
      const snapshot = await new StackIntrospector().snapshot(projectRoot, { persist: false });
      packagesCache = snapshot.packages;
      return {
        primary: snapshot.profile.frameworks[0] ?? snapshot.profile.toolchains[0]?.ecosystem ?? 'unknown',
        traits: snapshot.profile.traits,
        toolchains: snapshot.toolchains.map((toolchain) => toolchain.ecosystem),
      };
    },
    loadIndex: () => readCodeKnowledgeIndex(projectRoot),
    async vulnerabilities(offline) {
      if (isToolAvailable(availability, 'osv-scanner')) {
        const result = await shell.run('osv-scanner', ['--format', 'json', '--recursive', '.']);
        return { records: parseOsvScannerJson(result.stdout), blocked: [] };
      }
      if (offline) {
        return {
          records: [],
          blocked: [blockedFor('vulnerable-dependency', 'osv-scanner is not on PATH and the run is offline')],
        };
      }
      // Online fallback: native npm audit, else the OSV batch API.
      const audit = await shell.run('npm', ['audit', '--json']);
      const nativeRecords = parseNpmAuditJson(audit.stdout);
      if (nativeRecords.length > 0) return { records: nativeRecords, blocked: [] };
      return { records: await queryOsv(await packages()), blocked: [] };
    },
    async secrets() {
      if (isToolAvailable(availability, 'gitleaks')) {
        const result = await shell.run('gitleaks', [
          'detect',
          '--no-banner',
          '--report-format',
          'json',
          '--report-path',
          '/dev/stdout',
        ]);
        return { matches: parseGitleaksJson(result.stdout) };
      }
      return { matches: builtinSecretScan(await trackedFileContents(projectRoot, shell)) };
    },
    async duplication() {
      if (!isToolAvailable(availability, 'jscpd')) {
        return {
          clusters: [],
          blocked: [blockedFor('duplication', 'jscpd is not on PATH')],
        };
      }
      const outDir = join(PATHS.HEALTH_RUNS_DIR, 'jscpd');
      await shell.run('jscpd', ['--silent', '--reporters', 'json', '--output', outDir, '.']);
      /* v8 ignore next 3 -- the report file only exists after a real jscpd run */
      const clusters = readJscpdReport(join(projectRoot, outDir, 'jscpd-report.json'));
      return { clusters, blocked: [] };
    },
    async deprecations(offline) {
      if (offline) {
        return {
          records: [],
          blocked: [blockedFor('deprecated-dependency', 'deprecation checks need the network; the run is offline')],
        };
      }
      /* v8 ignore next 2 -- network path, not exercised in tests */
      return { records: [], blocked: [blockedFor('deprecated-dependency', 'no deprecation source configured')] };
    },
    async staleDocs() {
      return gatherStaleDocCandidates(await docTimestampInputs(projectRoot, shell));
    },
  };
}

function blockedFor(category: string, reason: string): HealthBlockedCheck {
  const spec = HEALTH_TOOLS.find((tool) => tool.used_for.includes(category as never));
  return {
    check: category,
    reason,
    install_hint: spec?.install_hint ?? healthToolSpec(category)?.install_hint ?? 'No fallback available.',
  };
}

/* v8 ignore start -- thin fs/shell wrappers exercised only in a real repo run */
function readJscpdReport(path: string): DuplicationCluster[] {
  try {
    return parseJscpdJson(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

async function trackedFileContents(
  projectRoot: string,
  shell: DeliveryShell,
): Promise<Array<{ path: string; content: string }>> {
  const listed = await shell.run('git', ['ls-files']);
  const files = listed.stdout.split('\n').filter(Boolean).slice(0, 5000);
  const out: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    try {
      out.push({ path: toPosixPath(file), content: readFileSync(join(projectRoot, file), 'utf8') });
    } catch {
      // unreadable / binary — skip
    }
  }
  return out;
}

async function docTimestampInputs(
  projectRoot: string,
  shell: DeliveryShell,
): Promise<DocTimestampInput[]> {
  const docs = await fg('docs/**/*.md', { cwd: projectRoot, dot: false });
  const inputs: DocTimestampInput[] = [];
  for (const doc of docs) {
    const docCommittedAt = await lastCommitEpoch(shell, doc);
    if (docCommittedAt === null) continue;
    const content = safeRead(join(projectRoot, doc));
    const references = extractReferencedSources(content, projectRoot);
    const withTimes = await Promise.all(
      references.map(async (source) => ({ source, committed_at: await lastCommitEpoch(shell, source) })),
    );
    inputs.push({ doc: toPosixPath(doc), doc_committed_at: docCommittedAt, references: withTimes });
  }
  return inputs;
}

function extractReferencedSources(content: string, projectRoot: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:src|runtime|scripts)\/[A-Za-z0-9_./-]+\.[a-z]{2,4}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const rel = match[0];
    try {
      readFileSync(join(projectRoot, rel), 'utf8');
      found.add(rel);
    } catch {
      // referenced path no longer exists — a stronger drift signal, but skip here
    }
  }
  return [...found].slice(0, 20);
}

async function lastCommitEpoch(shell: DeliveryShell, path: string): Promise<number | null> {
  const result = await shell.run('git', ['log', '-1', '--format=%ct', '--', path]);
  const epoch = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
/* v8 ignore stop */
