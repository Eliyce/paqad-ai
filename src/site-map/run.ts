import { join } from 'node:path';

import type { AppKind, AppMap, Evidence } from '@/core/types/site-map.js';
import type {
  SiteMapAppSummary,
  SiteMapBaseline,
  SiteMapBlockedCheck,
  SiteMapInventory,
  SiteMapReportIndex,
  SiteMapVerdict,
  SiteMapWorkflowName,
} from '@/core/types/site-map-run.js';

import { assembleSiteMapReport } from './assemble.js';
import { readBaseline, writeBaseline } from './baseline.js';
import { restampCanonicalTrust, type RestampCanonicalTrustResult } from './canonical-trust.js';
import {
  assembleExtraction,
  type ExtractedSurface,
  type ExtractionResult,
  type ExtractorOutput,
} from './extraction.js';
import { recordSiteMapRun } from './ledger.js';
import { writeJsonFile } from './shared.js';
import type { ExtractedTransition } from './transitions.js';
import { collectMapEvidence, type EvidenceResolution } from './verification.js';

export interface SiteMapGatherer {
  appKind(): AppKind;
  appSummary(): SiteMapAppSummary;
  loadAppMap(): AppMap | null;
  journeyCount(): number;
  extractors(): Promise<ExtractorOutput[]>;
  gatherTransitions(surfaces: ExtractedSurface[]): ExtractedTransition[];
  resolveEvidence(pointers: Evidence[]): EvidenceResolution[];
}

export interface SiteMapRunOptions {
  projectRoot: string;
  gatherer: SiteMapGatherer;
  workflow?: SiteMapWorkflowName;
  sessionId?: string | null;
  now?: () => Date;
  onInventory?: (inventory: SiteMapInventory) => void;
}

export interface SiteMapRunResult {
  report_id: string;
  bundle_dir: string;
  finding_count: number;
  blocked_checks: SiteMapBlockedCheck[];
  baseline_created: boolean;
  trust_restamp: RestampCanonicalTrustResult;
  verdict: SiteMapVerdict;
  inventory: SiteMapInventory;
  transition_count: number;
  exit_code: 0 | 1;
}

export function deriveSiteMapInventory(extraction: ExtractionResult): SiteMapInventory {
  const groups = new Set<string>();
  const guards = new Set<string>();
  for (const surface of extraction.surfaces) {
    if (surface.module !== undefined) groups.add(surface.module);
    for (const guard of surface.guards ?? []) guards.add(guard);
  }
  return {
    screens: extraction.surfaces.length,
    groups: [...groups].sort((a, b) => a.localeCompare(b)),
    guards: guards.size,
  };
}

export function describeSiteMapInventory(inventory: SiteMapInventory): string {
  return `Found ${inventory.screens} screens across ${inventory.groups.length} groups.`;
}

export function countMapTransitions(map: AppMap | null): number {
  if (map === null) return 0;
  return map.surfaces.reduce((total, surface) => total + (surface.transitions?.length ?? 0), 0);
}

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

export interface GatheredSiteMapReport {
  report: SiteMapReportIndex;
  findingIds: string[];
  extraction: ExtractionResult;
  map: AppMap | null;
  journeyCount: number;
  baseline: SiteMapBaseline | null;
}

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

  const codeTransitions = gatherer.gatherTransitions(extraction.surfaces);

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
    codeTransitions,
    journeyCount,
    blockedChecks: extraction.blocked_checks,
    baseline,
    sources,
  });

  return { report, findingIds, extraction, map, journeyCount, baseline };
}

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

  const inventory = deriveSiteMapInventory(extraction);
  options.onInventory?.(inventory);

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

  const transitionCount = countMapTransitions(map);
  const verdict = deriveSiteMapVerdict({
    findingCount: report.findings.length,
    hasStoredMap: map !== null,
    hasTransitions: transitionCount > 0,
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
    inventory,
    transition_count: transitionCount,
    exit_code: report.findings.length > 0 ? 1 : 0,
  };
}
