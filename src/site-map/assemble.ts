// Pure report assembly: given the loaded map, the extraction result, and the baseline, compute
// the deterministic reconciliation findings, assign stable ids, apply the baseline ratchet, and
// produce the SiteMapReportIndex. No I/O — the impure collector in `run.ts` gathers the inputs
// (reading the map, walking the tree via the injectable gatherer) and writes the outputs.
//
// The reconciliation implemented here is the "is every extracted surface mapped?" half of FR-7
// (category SM-ADD). The remaining Tier-A checks — SM-REMOVE, evidence `file:line` resolution
// (SM-EVIDENCE), cross-reference integrity (SM-XREF), and the graph invariants (SM-ORPHAN /
// SM-DEADEND / SM-GUARDLESS) — live in `./verification.ts` and are concatenated in below via
// `collectCandidates`, exactly as codebase-health's assemble concatenates detector outputs.

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
import { assignSiteMapFindingIds, sortFindings, toSiteMapReportId } from './shared.js';
import { deriveTrustFindings } from './trust.js';
import { collectVerificationFindings, type EvidenceResolution } from './verification.js';

export interface SiteMapAssemblyInput {
  workflow: SiteMapWorkflowName;
  now: Date;
  app: SiteMapAppSummary;
  /** The canonical map, or null when none exists yet (first run over an unmapped project). */
  map: AppMap | null;
  extraction: ExtractionResult;
  /** How each `file:line` the map cites resolved against the tree (the gatherer's Tier-A I/O). */
  evidenceResolutions: EvidenceResolution[];
  journeyCount: number;
  blockedChecks: SiteMapBlockedCheck[];
  baseline: SiteMapBaseline | null;
  /** Named inputs that fed the run (extractor names, `app-map.yaml`, `journeys/`). */
  sources: string[];
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
        'docs/site-map/app-map.yaml, or exclude it with a documented reason.',
      affected_surfaces: [surface.raw_id],
      affected_files: files,
      baseline_status: 'unknown',
      status: 'open',
    });
  }
  return candidates;
}

/**
 * Concatenate every category's candidates in a stable order — SM-ADD (extraction reconciliation)
 * then the Tier-A verification categories — plus any check the verification could not run.
 */
function collectCandidates(input: SiteMapAssemblyInput): {
  candidates: Array<Omit<SiteMapFinding, 'id'>>;
  blockedChecks: SiteMapBlockedCheck[];
} {
  const verification = collectVerificationFindings(input.map, input.evidenceResolutions);
  return {
    candidates: [
      ...detectUnmappedSurfaces(input.map, input.extraction),
      ...verification.candidates,
      ...deriveTrustFindings(input.map, input.evidenceResolutions),
    ],
    blockedChecks: verification.blockedChecks,
  };
}

/** Assemble the full run-report index from gathered inputs (pure). */
export function assembleSiteMapReport(input: SiteMapAssemblyInput): AssembledSiteMapReport {
  const { candidates, blockedChecks: verificationBlocked } = collectCandidates(input);
  const withIds = assignSiteMapFindingIds(candidates);
  const findings = sortFindings(applyBaselineStatus(withIds, input.baseline));

  const reportId = toSiteMapReportId('SITEMAP', input.now);
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
    bundle_dir: bundleDir,
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
    blocked_checks: [...input.blockedChecks, ...verificationBlocked],
    baseline: {
      existed: input.baseline !== null,
      new_since_baseline: newSinceBaseline,
      pre_existing: preExisting,
    },
    sources_used: [...new Set(input.sources)].sort(),
  };

  return { report, findings, findingIds: findings.map((finding) => finding.id) };
}
