// Reclassify a prior site-map report against a fresh scan, matched by stable `SM-` id (never
// by category or surface label). A finding whose id reappears is `still-open`; a deterministic
// finding whose id is gone is `fixed`; an ai-judged finding whose id is gone is
// `needs-manual-verification`, because a deterministic re-scan cannot re-derive an ai-judged
// finding, so its absence is not proof of a fix. Ids are preserved and severity is never lowered.

import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import type {
  SiteMapFinding,
  SiteMapReportIndex,
  SiteMapRetestFinding,
  SiteMapRetestStatus,
} from '@/core/types/site-map-run.js';
import { VERSION } from '@/index.js';

import { nextRemediationPriorities } from './report-builder.js';
import { sortFindings, toSiteMapReportId, toSiteMapTimestamp } from './shared.js';

/** Reclassify each source finding by whether its stable id reproduces in the fresh scan. */
export function buildSiteMapRetestFindings(
  sourceFindings: Array<SiteMapFinding | SiteMapRetestFinding>,
  currentFindings: SiteMapFinding[],
): SiteMapRetestFinding[] {
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  return sourceFindings.map((finding) => {
    const retestStatus = evaluateRetestStatus(finding, currentIds);
    return { ...finding, status: retestStatus, retest_status: retestStatus };
  });
}

function evaluateRetestStatus(
  finding: SiteMapFinding,
  currentIds: Set<string>,
): SiteMapRetestStatus {
  if (currentIds.has(finding.id)) {
    return 'still-open';
  }
  // A deterministic re-scan cannot re-derive an ai-judged finding, so its absence is not proof
  // of a fix — a human confirms it.
  if (finding.tier === 'ai-judged') {
    return 'needs-manual-verification';
  }
  return 'fixed';
}

export interface SiteMapRetestReportInput {
  now: Date;
  source: SiteMapReportIndex;
  retestFindings: SiteMapRetestFinding[];
}

/** Assemble the retest report index (pure). Filenames follow `<orig-ts>-retest-<ts>`. */
export function buildSiteMapRetestReportIndex(input: SiteMapRetestReportInput): SiteMapReportIndex {
  const timestamp = toSiteMapTimestamp(input.now);
  const origTimestamp = input.source.report_id.replace(/^(?:SITEMAP|RETEST)-/, '');
  const base = `${origTimestamp}-retest-${timestamp}`;
  const reportId = toSiteMapReportId('RETEST', input.now);
  const findings = sortFindings(input.retestFindings);
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    report_id: reportId,
    workflow: 'site-map-retest',
    generated_at: input.now.toISOString(),
    report_path: toPosixPath(join(PATHS.SITE_MAP_REPORT_DIR, `${base}.md`)),
    sidecar_path: toPosixPath(join(PATHS.SITE_MAP_REPORT_DIR, `${base}.json`)),
    bundle_dir: toPosixPath(join(PATHS.SITE_MAP_RUNS_DIR, reportId)),
    source_report_path: input.source.sidecar_path,
    source_report_id: input.source.report_id,
    app: input.source.app,
    surface_count: input.source.surface_count,
    journey_count: input.source.journey_count,
    extraction: input.source.extraction,
    findings,
    blocked_checks: input.source.blocked_checks,
    baseline: input.source.baseline,
    sources_used: input.source.sources_used,
    next_remediation_priorities: nextRemediationPriorities(findings),
  };
}
