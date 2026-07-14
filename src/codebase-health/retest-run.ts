import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { HealthReportIndex } from '@/core/types/codebase-health.js';

import { assembleHealthReport } from './assemble.js';
import { readBaseline } from './baseline.js';
import { buildHealthMarkdown } from './report-builder.js';
import { buildHealthRetestFindings, buildRetestReportIndex } from './retest.js';
import { findLatestSidecar, readHealthSidecar } from './store.js';
import { writeJsonFile } from './shared.js';
import { createHealthGatherer, type HealthGatherer } from './run.js';

export interface HealthRetestOptions {
  projectRoot: string;
  offline?: boolean;
  /** An explicit source sidecar; defaults to the newest `docs/health/*.json`. */
  sidecar?: string | null;
  now?: () => Date;
  gatherer?: HealthGatherer;
}

export type HealthRetestResult =
  | {
      ok: true;
      report_id: string;
      report_path: string;
      sidecar_path: string;
      fixed: number;
      still_open: number;
      needs_manual_verification: number;
      exit_code: 0 | 1;
    }
  | { ok: false; reason: string };

/** Re-run the evidence and reclassify each source finding by its stable id. */
export async function runHealthRetest(options: HealthRetestOptions): Promise<HealthRetestResult> {
  const { projectRoot } = options;
  const offline = options.offline ?? false;
  const now = options.now ?? (() => new Date());
  const gatherer = options.gatherer ?? createHealthGatherer(projectRoot);

  const sidecarPath = options.sidecar
    ? join(projectRoot, options.sidecar)
    : findLatestSidecar(projectRoot);
  if (!sidecarPath) {
    return { ok: false, reason: 'no prior health report found — run `paqad-ai health run` first' };
  }
  const source = readHealthSidecar(sidecarPath);
  if (!source) {
    return { ok: false, reason: `could not read a valid health sidecar at ${sidecarPath}` };
  }

  const current = await gatherCurrentFindings(projectRoot, gatherer, offline, now);
  const retestFindings = buildHealthRetestFindings(source.findings, current.findings, offline);
  const report = buildRetestReportIndex({ now: now(), offline, source, retestFindings });

  await writeJsonFile(join(projectRoot, report.sidecar_path), report);
  await writeMarkdown(join(projectRoot, report.report_path), buildHealthMarkdown(report));

  const count = (status: string): number =>
    retestFindings.filter((finding) => finding.retest_status === status).length;

  return {
    ok: true,
    report_id: report.report_id,
    report_path: report.report_path,
    sidecar_path: report.sidecar_path,
    fixed: count('fixed'),
    still_open: count('still-open'),
    needs_manual_verification: count('needs-manual-verification'),
    exit_code: count('still-open') > 0 ? 1 : 0,
  };
}

async function gatherCurrentFindings(
  projectRoot: string,
  gatherer: HealthGatherer,
  offline: boolean,
  now: () => Date,
): Promise<{ findings: HealthReportIndex['findings'] }> {
  const [stack, vulns, secrets, duplication, deprecations, staleDocs] = await Promise.all([
    gatherer.stack(),
    gatherer.vulnerabilities(offline),
    gatherer.secrets(),
    gatherer.duplication(),
    gatherer.deprecations(offline),
    gatherer.staleDocs(),
  ]);
  const { report } = assembleHealthReport({
    workflow: 'codebase-health',
    now: now(),
    offline,
    stack,
    availability: gatherer.availability(),
    index: gatherer.loadIndex(),
    vulnRecords: vulns.records,
    secretMatches: secrets.matches,
    duplicationClusters: duplication.clusters,
    deprecationRecords: deprecations.records,
    staleDocCandidates: staleDocs,
    blockedChecks: [],
    baseline: readBaseline(projectRoot),
  });
  return { findings: report.findings };
}

async function writeMarkdown(target: string, markdown: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markdown);
}
