// Pure report assembly: given the loaded map, the extraction result, and the baseline, compute
// the deterministic reconciliation findings, assign stable ids, apply the baseline ratchet, and
// produce the SiteMapReportIndex. No I/O — the impure collector in `run.ts` gathers the inputs
// (reading the map, walking the tree via the injectable gatherer) and writes the outputs.
//
// Scope note (S4): the reconciliation implemented here is the "is every extracted surface
// mapped?" half of FR-7 (category SM-ADD). The remaining Tier-A checks — SM-REMOVE, evidence
// `file:line` resolution (SM-EVIDENCE), cross-reference integrity (SM-XREF), and the graph
// invariants (SM-ORPHAN / SM-DEADEND / SM-GUARDLESS) — land in the verification slice and plug
// their candidates into `collectCandidates`, exactly as codebase-health's assemble concatenates
// detector outputs.

import { join } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { AppMap, Evidence, EvidenceRef } from '@/core/types/site-map.js';
import type {
  SiteMapAppSummary,
  SiteMapBaseline,
  SiteMapBlockedCheck,
  SiteMapFinding,
  SiteMapReportIndex,
  SiteMapWorkflowName,
} from '@/core/types/site-map-run.js';

import { applyBaselineStatus } from './baseline.js';
import type { ExtractionResult } from './extraction.js';
import { nextRemediationPriorities } from './report-builder.js';
import {
  assignSiteMapFindingIds,
  sortFindings,
  toSiteMapReportId,
  toSiteMapTimestamp,
} from './shared.js';

export interface SiteMapAssemblyInput {
  workflow: SiteMapWorkflowName;
  now: Date;
  app: SiteMapAppSummary;
  /** The canonical map, or null when none exists yet (first run over an unmapped project). */
  map: AppMap | null;
  extraction: ExtractionResult;
  journeyCount: number;
  blockedChecks: SiteMapBlockedCheck[];
  baseline: SiteMapBaseline | null;
  /** Named inputs that fed the run (extractor names, `app-map.yaml`, `journeys/`). */
  sources: string[];
  sourceReportPath?: string | null;
  sourceReportId?: string | null;
}

export interface AssembledSiteMapReport {
  report: SiteMapReportIndex;
  findings: SiteMapFinding[];
  findingIds: string[];
}

/** Normalize a single-or-list evidence ref into a flat array. */
function normalizeEvidence(ref: EvidenceRef | undefined): Evidence[] {
  if (ref === undefined) return [];
  return Array.isArray(ref) ? ref : [ref];
}

/** Two evidence pointers match on the same file; a present line on both sides must also agree. */
function evidenceMatch(a: Evidence, b: Evidence): boolean {
  if (a.file !== b.file) return false;
  if (a.line === undefined || b.line === undefined) return true;
  return a.line === b.line;
}

/**
 * SM-ADD: every extracted surface must be present in the map. An extracted surface is "mapped"
 * when the map cites overlapping `file:line` evidence for some surface; otherwise the map is
 * missing it. With no map (first run) every extracted surface is unmapped — the useful first
 * signal ("here is what to map"). Deterministic: pure over the sorted extraction + the map.
 */
export function detectUnmappedSurfaces(
  map: AppMap | null,
  extraction: ExtractionResult,
): Array<Omit<SiteMapFinding, 'id'>> {
  const mappedEvidence = (map?.surfaces ?? []).flatMap((surface) =>
    normalizeEvidence(surface.evidence),
  );
  const candidates: Array<Omit<SiteMapFinding, 'id'>> = [];
  for (const surface of extraction.surfaces) {
    const isMapped = surface.evidence.some((extracted) =>
      mappedEvidence.some((mapped) => evidenceMatch(extracted, mapped)),
    );
    if (isMapped) continue;
    const files = [...new Set(surface.evidence.map((evidence) => evidence.file))].sort();
    candidates.push({
      title: `Unmapped ${surface.kind}: ${surface.label}`,
      description:
        `The ${surface.kind} "${surface.label}" exists in code but is absent from the site ` +
        'map, so the map under-describes the product.',
      category: 'SM-ADD',
      // A high-confidence extractor found a real surface (map incompleteness); the generic
      // fallback is convention-based, so its gaps are lower severity.
      severity: surface.confidence === 'high' ? 'medium' : 'low',
      tier: 'deterministic',
      confidence: 1,
      evidence: surface.evidence.map(
        (evidence) =>
          `${surface.source} extractor — ${evidence.file}` +
          (evidence.line === undefined ? '' : `:${evidence.line}`),
      ),
      resolution:
        `Add a surface for "${surface.label}" (raw id ${surface.raw_id}) to ` +
        'docs/instructions/site-map/app-map.yaml, or exclude it with a documented reason.',
      affected_surfaces: [surface.raw_id],
      affected_files: files,
      baseline_status: 'unknown',
      status: 'open',
    });
  }
  return candidates;
}

/** Concatenate every reconciliation category's candidates in a stable order. */
function collectCandidates(input: SiteMapAssemblyInput): Array<Omit<SiteMapFinding, 'id'>> {
  return detectUnmappedSurfaces(input.map, input.extraction);
}

/** Assemble the full run-report index from gathered inputs (pure). */
export function assembleSiteMapReport(input: SiteMapAssemblyInput): AssembledSiteMapReport {
  const withIds = assignSiteMapFindingIds(collectCandidates(input));
  const findings = sortFindings(applyBaselineStatus(withIds, input.baseline));

  const timestamp = toSiteMapTimestamp(input.now);
  const reportId = toSiteMapReportId('SITEMAP', input.now);
  const reportPath = toPosixPath(join(PATHS.SITE_MAP_REPORT_DIR, `${timestamp}.md`));
  const sidecarPath = toPosixPath(join(PATHS.SITE_MAP_REPORT_DIR, `${timestamp}.json`));
  const bundleDir = toPosixPath(join(PATHS.SITE_MAP_RUNS_DIR, reportId));

  const newSinceBaseline = findings.filter(
    (finding) => finding.baseline_status === 'new-since-baseline',
  ).length;
  const preExisting = findings.filter(
    (finding) => finding.baseline_status === 'pre-existing',
  ).length;

  const report: SiteMapReportIndex = {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    report_id: reportId,
    workflow: input.workflow,
    generated_at: input.now.toISOString(),
    report_path: reportPath,
    sidecar_path: sidecarPath,
    bundle_dir: bundleDir,
    source_report_path: input.sourceReportPath ?? null,
    source_report_id: input.sourceReportId ?? null,
    app: input.app,
    surface_count: input.map?.surfaces.length ?? 0,
    journey_count: input.journeyCount,
    extraction: {
      extractors_ran: input.extraction.extractors_ran,
      extracted_surfaces: input.extraction.surfaces.length,
      low_confidence_fallback: input.extraction.low_confidence_fallback,
      fingerprint: input.extraction.fingerprint,
    },
    findings,
    blocked_checks: input.blockedChecks,
    baseline: {
      existed: input.baseline !== null,
      new_since_baseline: newSinceBaseline,
      pre_existing: preExisting,
    },
    sources_used: [...new Set(input.sources)].sort(),
    next_remediation_priorities: nextRemediationPriorities(findings),
  };

  return { report, findings, findingIds: findings.map((finding) => finding.id) };
}
