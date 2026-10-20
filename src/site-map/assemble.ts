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
import {
  buildUnresolvedLinksCheck,
  resolveTransitions,
  type ExtractedTransition,
  type ResolvedTransition,
} from './transitions.js';
import { deriveTrustFindings } from './trust.js';
import { collectVerificationFindings, type EvidenceResolution } from './verification.js';

export interface SiteMapAssemblyInput {
  workflow: SiteMapWorkflowName;
  now: Date;
  app: SiteMapAppSummary;
  map: AppMap | null;
  extraction: ExtractionResult;
  evidenceResolutions: EvidenceResolution[];
  codeTransitions: ExtractedTransition[];
  journeyCount: number;
  blockedChecks: SiteMapBlockedCheck[];
  baseline: SiteMapBaseline | null;
  sources: string[];
}

export interface AssembledSiteMapReport {
  report: SiteMapReportIndex;
  findings: SiteMapFinding[];
  findingIds: string[];
}

function normalizeEvidence(ref: EvidenceRef | undefined): Evidence[] {
  if (ref === undefined) return [];
  return Array.isArray(ref) ? ref : [ref];
}

function evidenceMatch(a: Evidence, b: Evidence): boolean {
  if (a.file !== b.file) return false;
  if (a.line === undefined || b.line === undefined) return true;
  return a.line === b.line;
}

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

export function detectMissingEdges(
  map: AppMap,
  resolved: ResolvedTransition[],
): Array<Omit<SiteMapFinding, 'id'>> {
  const recorded = new Map<string, Set<string>>();
  for (const surface of map.surfaces) {
    recorded.set(
      surface.id,
      new Set((surface.transitions ?? []).map((transition) => transition.to)),
    );
  }
  const seen = new Set<string>();
  const candidates: Array<Omit<SiteMapFinding, 'id'>> = [];
  for (const edge of resolved) {
    const from = edge.from_id;
    const to = edge.transition.to;
    const recordedFrom = recorded.get(from);
    if (recordedFrom === undefined) continue;
    const key = `${from} -> ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (recordedFrom.has(to)) continue;
    const pointers = normalizeEvidence(edge.transition.evidence);
    const files = [...new Set(pointers.map((pointer) => pointer.file))].sort();
    candidates.push({
      title: `Unmapped link: ${from} → ${to}`,
      description:
        `The code navigates from "${from}" to "${to}" (${edge.transition.trigger}), but the site ` +
        'map records no such transition, so the map under-describes how users move through the product.',
      category: 'SM-EDGE-MISSING',
      severity: edge.transition.confidence === 'high' ? 'medium' : 'low',
      tier: 'deterministic',
      confidence: 1,
      evidence: pointers.map(
        (pointer) =>
          `code — ${pointer.file}${pointer.line === undefined ? '' : `:${pointer.line}`} ` +
          `navigates ${from} → ${to}`,
      ),
      resolution:
        `Add a "${edge.transition.trigger}" transition from "${from}" to "${to}" in ` +
        `${PATHS.SITE_MAP_CANONICAL_APP_MAP} (or re-run \`sitemap draft\` to record it), or exclude ` +
        'it with a documented reason.',
      affected_surfaces: [from, to],
      affected_files: files,
      baseline_status: 'unknown',
      status: 'open',
    });
  }
  return candidates;
}

function reconcileEdges(
  map: AppMap,
  codeTransitions: ExtractedTransition[],
): { candidates: Array<Omit<SiteMapFinding, 'id'>>; blockedChecks: SiteMapBlockedCheck[] } {
  const resolution = resolveTransitions(codeTransitions, map.surfaces);
  const unresolved = buildUnresolvedLinksCheck(resolution.dropped);
  return {
    candidates: detectMissingEdges(map, resolution.resolved),
    blockedChecks: unresolved === null ? [] : [unresolved],
  };
}

function collectCandidates(input: SiteMapAssemblyInput): {
  candidates: Array<Omit<SiteMapFinding, 'id'>>;
  blockedChecks: SiteMapBlockedCheck[];
} {
  const verification = collectVerificationFindings(input.map, input.evidenceResolutions);
  const edges =
    input.map === null
      ? { candidates: [], blockedChecks: [] }
      : reconcileEdges(input.map, input.codeTransitions);
  return {
    candidates: [
      ...detectUnmappedSurfaces(input.map, input.extraction),
      ...verification.candidates,
      ...edges.candidates,
      ...deriveTrustFindings(input.map, input.evidenceResolutions),
    ],
    blockedChecks: [...verification.blockedChecks, ...edges.blockedChecks],
  };
}

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
