// The orchestrator: gather raw inputs through an injectable SiteMapGatherer, assemble the run
// report (pure), and persist the run's evidence bundle and ledger row. The report itself stays
// in memory for the caller (CLI summary, dashboard job result) — there are no timestamped
// report dumps and no derived-view publication (issue #466, ART-3): `docs/site-map/` holds only
// the current AI-authored map, and the run's lasting write-back is the trust + freshness
// restamp onto that canonical map. Tests drive the whole run offline with a fake gatherer.
//
// Unlike codebase-health, the gatherer is REQUIRED, not defaulted: the production gatherer walks
// the commander program and the source tree, which is the CLI's own structure, so it is provided
// by the `paqad-ai sitemap` verb (the CLI slice) rather than defaulted here. That keeps this
// orchestrator fully exercised offline with zero un-covered real-world seam.

import { join } from 'node:path';

import type { AppKind, AppMap, Evidence } from '@/core/types/site-map.js';
import type {
  SiteMapAppSummary,
  SiteMapBaseline,
  SiteMapBlockedCheck,
  SiteMapReportIndex,
  SiteMapVerdict,
  SiteMapWorkflowName,
} from '@/core/types/site-map-run.js';

import { assembleSiteMapReport } from './assemble.js';
import { readBaseline, writeBaseline } from './baseline.js';
import { restampCanonicalTrust, type RestampCanonicalTrustResult } from './canonical-trust.js';
import { assembleExtraction, type ExtractionResult, type ExtractorOutput } from './extraction.js';
import { recordSiteMapRun } from './ledger.js';
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
  sessionId?: string | null;
  now?: () => Date;
}

export interface SiteMapRunResult {
  report_id: string;
  bundle_dir: string;
  finding_count: number;
  blocked_checks: SiteMapBlockedCheck[];
  baseline_created: boolean;
  /**
   * Whether this run re-earned the canonical map's trust tiers + map-vs-code freshness and wrote
   * them back (issue #466, C8). `no-map` until an AI-authored `docs/site-map/app-map.yaml` exists,
   * so the wire is a no-op on a project that has not authored its map yet.
   */
  trust_restamp: RestampCanonicalTrustResult;
  /**
   * The paqad verdict for this run (issue D4): `attention` on any finding, `inconclusive` when a
   * check could not reach a confident result (no stored map, a map with no navigation, or any
   * blocked check), else `safe`. Distinct from `exit_code`, which is unchanged.
   */
  verdict: SiteMapVerdict;
  /** 0 clean · 1 findings · (2 is reserved for the CLI on an unexpected error). */
  exit_code: 0 | 1;
}

/**
 * Decide a run's verdict from its outcome (pure — no I/O). A run reads `attention` when it found
 * anything; otherwise it is only `safe` when there is a stored map that records navigation and no
 * check was blocked — anything less is `inconclusive`, so a run over an absent or link-less map can
 * never masquerade as clean (D4). The exit code is decided separately and is not affected.
 */
export function deriveSiteMapVerdict(input: {
  findingCount: number;
  hasStoredMap: boolean;
  hasTransitions: boolean;
  blockedChecks: SiteMapBlockedCheck[];
}): SiteMapVerdict {
  if (input.findingCount > 0) return 'attention';
  if (!input.hasStoredMap || !input.hasTransitions || input.blockedChecks.length > 0) {
    return 'inconclusive';
  }
  return 'safe';
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
 * Gather the raw inputs and assemble the run report — the read-and-assemble half of a run,
 * with no writes. `runSiteMapAudit` calls it and persists the evidence bundle; keeping the
 * read half separate keeps the whole pipeline drivable offline behind a fake gatherer.
 */
export async function gatherSiteMapReport(options: {
  projectRoot: string;
  gatherer: SiteMapGatherer;
  workflow: SiteMapWorkflowName;
  now: Date;
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
  });

  return { report, findingIds, extraction, map, journeyCount, baseline };
}

/** Run the full audit and persist the run's evidence bundle and ledger row. */
export async function runSiteMapAudit(options: SiteMapRunOptions): Promise<SiteMapRunResult> {
  const { projectRoot, gatherer } = options;
  const workflow = options.workflow ?? 'site-map';
  const now = options.now ?? (() => new Date());
  const runNow = now();

  const { report, findingIds, extraction, baseline, map } = await gatherSiteMapReport({
    projectRoot,
    gatherer,
    workflow,
    now: runNow,
  });

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

  const verdict = deriveSiteMapVerdict({
    findingCount: report.findings.length,
    hasStoredMap: map !== null,
    hasTransitions: map !== null && map.surfaces.some((s) => (s.transitions?.length ?? 0) > 0),
    blockedChecks: report.blocked_checks,
  });

  return {
    report_id: report.report_id,
    bundle_dir: report.bundle_dir,
    finding_count: report.findings.length,
    blocked_checks: report.blocked_checks,
    baseline_created: baselineCreated,
    trust_restamp: trustRestamp,
    verdict,
    exit_code: report.findings.length > 0 ? 1 : 0,
  };
}
