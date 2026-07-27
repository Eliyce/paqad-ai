// `paqad-ai sitemap retest` — replay a prior site-map report against the current code. It reads
// the source sidecar, recomputes the CURRENT findings through the shared gather+assemble path
// (no fresh report written), reclassifies each source finding by its stable `SM-` id, and writes
// a retest report `<orig-ts>-retest-<ts>.{md,json}`. Mirror of `runHealthRetest`.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildSiteMapMarkdown } from './report-builder.js';
import { buildSiteMapRetestFindings, buildSiteMapRetestReportIndex } from './retest.js';
import { gatherSiteMapReport, type SiteMapGatherer } from './run.js';
import { writeJsonFile } from './shared.js';
import { findLatestSiteMapSidecar, readSiteMapSidecar } from './store.js';

export interface SiteMapRetestOptions {
  projectRoot: string;
  gatherer: SiteMapGatherer;
  /** An explicit source sidecar; defaults to the newest `docs/site-map/*.json`. */
  sidecar?: string | null;
  now?: () => Date;
}

export type SiteMapRetestResult =
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

/** Re-run the evidence and reclassify each source finding by its stable `SM-` id. */
export async function runSiteMapRetest(
  options: SiteMapRetestOptions,
): Promise<SiteMapRetestResult> {
  const { projectRoot, gatherer } = options;
  const now = options.now ?? (() => new Date());

  const sidecarPath = options.sidecar
    ? join(projectRoot, options.sidecar)
    : findLatestSiteMapSidecar(projectRoot);
  if (!sidecarPath) {
    return {
      ok: false,
      reason: 'no prior site-map report found — run `paqad-ai sitemap run` first',
    };
  }
  const source = readSiteMapSidecar(sidecarPath);
  if (!source) {
    return { ok: false, reason: `could not read a valid site-map sidecar at ${sidecarPath}` };
  }

  const runNow = now();
  const { report: current } = await gatherSiteMapReport({
    projectRoot,
    gatherer,
    workflow: 'site-map',
    now: runNow,
  });
  const retestFindings = buildSiteMapRetestFindings(source.findings, current.findings);
  const report = buildSiteMapRetestReportIndex({ now: runNow, source, retestFindings });

  await writeJsonFile(join(projectRoot, report.sidecar_path), report);
  await writeMarkdown(join(projectRoot, report.report_path), buildSiteMapMarkdown(report));

  const count = (status: string): number =>
    retestFindings.filter((finding) => finding.retest_status === status).length;
  const stillOpen = count('still-open');

  return {
    ok: true,
    report_id: report.report_id,
    report_path: report.report_path,
    sidecar_path: report.sidecar_path,
    fixed: count('fixed'),
    still_open: stillOpen,
    needs_manual_verification: count('needs-manual-verification'),
    exit_code: stillOpen > 0 ? 1 : 0,
  };
}

async function writeMarkdown(target: string, markdown: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markdown);
}
