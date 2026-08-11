// The orchestrator: gather raw inputs through an injectable SiteMapGatherer, assemble the run
// report (pure), and dual-write the outputs plus the run bundle and ledger row. Tests drive the
// whole run offline with a fake gatherer.
//
// Unlike codebase-health, the gatherer is REQUIRED, not defaulted: the production gatherer walks
// the commander program and the source tree, which is the CLI's own structure, so it is provided
// by the `paqad-ai sitemap` verb (the CLI slice) rather than defaulted here. That keeps this
// orchestrator fully exercised offline with zero un-covered real-world seam.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AppKind, AppMap, Evidence } from '@/core/types/site-map.js';
import type {
  SiteMapAppSummary,
  SiteMapBaseline,
  SiteMapBlockedCheck,
  SiteMapReportIndex,
  SiteMapWorkflowName,
} from '@/core/types/site-map-run.js';

import { assembleSiteMapReport } from './assemble.js';
import { readBaseline, writeBaseline } from './baseline.js';
import { restampCanonicalTrust, type RestampCanonicalTrustResult } from './canonical-trust.js';
import { assembleExtraction, type ExtractionResult, type ExtractorOutput } from './extraction.js';
import { recordSiteMapRun } from './ledger.js';
import { publishSiteMap } from './publish.js';
import { buildSiteMapMarkdown } from './report-builder.js';
import { writeJsonFile } from './shared.js';
import { collectMapEvidence, type EvidenceResolution } from './verification.js';

/** Everything the run needs from the outside world — injected for tests, provided by the CLI. */
export interface SiteMapGatherer {
  /** The mapped product's primary kind (drives the generic-vs-dedicated extractor choice). */
  appKind(): AppKind;
  /** The product header for the run report. */
  appSummary(): SiteMapAppSummary;
  /** The canonical map, or null when none exists yet. */
  loadAppMap(): AppMap | null;
  /** How many curated journeys are on disk. */
  journeyCount(): number;
  /** Each extractor's contribution: its surfaces, or a blocked check when unavailable (FR-3). */
  extractors(): Promise<ExtractorOutput[]>;
  /** Resolve each `file:line` the map cites against the tree — the only I/O Tier-A verification
   * depends on, so the whole run stays deterministic behind a fake gatherer in tests. */
  resolveEvidence(pointers: Evidence[]): EvidenceResolution[];
}

export interface SiteMapRunOptions {
  projectRoot: string;
  gatherer: SiteMapGatherer;
  workflow?: SiteMapWorkflowName;
  sourceReportPath?: string | null;
  sourceReportId?: string | null;
  sessionId?: string | null;
  now?: () => Date;
}

export interface SiteMapRunResult {
  report_id: string;
  report_path: string;
  sidecar_path: string;
  bundle_dir: string;
  finding_count: number;
  blocked_checks: SiteMapBlockedCheck[];
  baseline_created: boolean;
  /** Derived views (index/overview/registries) whose bytes changed and were (re)written. */
  published: string[];
  /** Derived views already up to date, left untouched (differential refresh). */
  publish_skipped: string[];
  /** Derived views a prior run produced that the map no longer produces — deleted this run. */
  publish_removed: string[];
  /**
   * Whether this run re-earned the canonical map's trust tiers + map-vs-code freshness and wrote
   * them back (issue #466, C8). `no-map` until an AI-authored `docs/site-map/app-map.yaml` exists,
   * so the wire is a no-op on a project that has not authored its map yet.
   */
  trust_restamp: RestampCanonicalTrustResult;
  /** 0 clean · 1 findings · (2 is reserved for the CLI on an unexpected error). */
  exit_code: 0 | 1;
}

/** Everything the gather+assemble step produces, before any writes. */
export interface GatheredSiteMapReport {
  report: SiteMapReportIndex;
  findingIds: string[];
  /** The full extraction (not the report's summary) — written verbatim into the run bundle. */
  extraction: ExtractionResult;
  map: AppMap | null;
  journeyCount: number;
  baseline: SiteMapBaseline | null;
}

/**
 * Gather the raw inputs and assemble the run report — the shared read-and-assemble half of a
 * run, with no writes. `runSiteMapAudit` calls it and persists; `runSiteMapRetest` calls it to
 * recompute the CURRENT findings without dual-writing a fresh report. One code path, so the two
 * verbs can never drift in how they read the app (RULE-13).
 */
export async function gatherSiteMapReport(options: {
  projectRoot: string;
  gatherer: SiteMapGatherer;
  workflow: SiteMapWorkflowName;
  now: Date;
  sourceReportPath?: string | null;
  sourceReportId?: string | null;
}): Promise<GatheredSiteMapReport> {
  const { projectRoot, gatherer } = options;
  const map = gatherer.loadAppMap();
  const journeyCount = gatherer.journeyCount();
  const appSummary = gatherer.appSummary();
  const evidenceResolutions = gatherer.resolveEvidence(collectMapEvidence(map));

  const outputs = await gatherer.extractors();
  const extraction = assembleExtraction(outputs, gatherer.appKind());

  const sources: string[] = outputs
    .filter((output) => output.available)
    .map((output) => output.extractor);
  if (map !== null) sources.push('app-map.yaml');
  if (journeyCount > 0) sources.push('journeys');

  const baseline = readBaseline(projectRoot);
  const { report, findingIds } = assembleSiteMapReport({
    workflow: options.workflow,
    now: options.now,
    app: appSummary,
    map,
    extraction,
    evidenceResolutions,
    journeyCount,
    blockedChecks: extraction.blocked_checks,
    baseline,
    sources,
    sourceReportPath: options.sourceReportPath ?? null,
    sourceReportId: options.sourceReportId ?? null,
  });

  return { report, findingIds, extraction, map, journeyCount, baseline };
}

/** Run the full audit and dual-write the report, the run bundle, and the ledger row. */
export async function runSiteMapAudit(options: SiteMapRunOptions): Promise<SiteMapRunResult> {
  const { projectRoot, gatherer } = options;
  const workflow = options.workflow ?? 'site-map';
  const now = options.now ?? (() => new Date());
  const runNow = now();

  const { report, findingIds, extraction, map, journeyCount, baseline } = await gatherSiteMapReport(
    {
      projectRoot,
      gatherer,
      workflow,
      now: runNow,
      sourceReportPath: options.sourceReportPath,
      sourceReportId: options.sourceReportId,
    },
  );

  await writeJsonFile(join(projectRoot, report.sidecar_path), report);
  await writeMarkdown(join(projectRoot, report.report_path), buildSiteMapMarkdown(report));
  await writeJsonFile(join(projectRoot, report.bundle_dir, 'finding-index.json'), {
    report_id: report.report_id,
    findings: report.findings,
  });
  await writeJsonFile(join(projectRoot, report.bundle_dir, 'extraction.json'), extraction);

  let baselineCreated = false;
  if (baseline === null) {
    await writeBaseline(projectRoot, findingIds, runNow);
    baselineCreated = true;
  }

  // Publication is a projection of the canonical map, so it only runs once a map exists;
  // with no map yet the run's job is to tell you what to map (SM-ADD findings), not to
  // publish empty views. Differential refresh means an unchanged map rewrites nothing.
  let published: string[] = [];
  let publishSkipped: string[] = [];
  let publishRemoved: string[] = [];
  if (map !== null) {
    const publication = await publishSiteMap({ projectRoot, map, journeyCount, now });
    published = publication.published;
    publishSkipped = publication.skipped;
    publishRemoved = publication.removed;
  }

  // Re-earn the canonical map's honest trust tiers + map-vs-code freshness from the SAME evidence
  // the run already resolved (the gatherer's one resolveEvidence seam), and write them back when
  // either moved (issue #466, C8: this is the wire that makes `map.app.freshness` non-null on a
  // real project, so the dashboard honesty strip and the freshness gate read earned proof rather
  // than "not yet checked"). It operates on the canonical `docs/site-map/` location directly and is
  // a no-op (`no-map`) until that map is authored, so it never regresses a project without one.
  const trustRestamp = restampCanonicalTrust(projectRoot, (pointers) =>
    gatherer.resolveEvidence(pointers),
  );

  recordSiteMapRun(
    projectRoot,
    {
      report_id: report.report_id,
      workflow: report.workflow,
      surface_count: report.surface_count,
      journey_count: report.journey_count,
      finding_count: report.findings.length,
      blocked_count: report.blocked_checks.length,
      new_since_baseline: report.baseline.new_since_baseline,
      pre_existing: report.baseline.pre_existing,
    },
    { sessionId: options.sessionId, now },
  );

  return {
    report_id: report.report_id,
    report_path: report.report_path,
    sidecar_path: report.sidecar_path,
    bundle_dir: report.bundle_dir,
    finding_count: report.findings.length,
    blocked_checks: report.blocked_checks,
    baseline_created: baselineCreated,
    published,
    publish_skipped: publishSkipped,
    publish_removed: publishRemoved,
    trust_restamp: trustRestamp,
    exit_code: report.findings.length > 0 ? 1 : 0,
  };
}

async function writeMarkdown(target: string, markdown: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markdown);
}
