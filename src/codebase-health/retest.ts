import { join } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import type {
  HealthFinding,
  HealthReportIndex,
  HealthRetestFinding,
  HealthRetestStatus,
} from '@/core/types/codebase-health.js';

import { nextRemediationPriorities } from './report-builder.js';
import { sortFindings, toHealthReportId, toHealthTimestamp } from './shared.js';

/**
 * Reclassify each source finding against a fresh scan, matched by stable `HL-`
 * id (better than pentest's coarse category matching). A network-required finding
 * that could not be re-checked offline is `needs-manual-verification`; a finding
 * whose id reappears is `still-open`; otherwise it is `fixed`. Ids are preserved
 * and severity is never lowered.
 */
export function buildHealthRetestFindings(
  sourceFindings: HealthFinding[],
  currentFindings: HealthFinding[],
  offline: boolean,
): HealthRetestFinding[] {
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  return sourceFindings.map((finding) => {
    const retestStatus = evaluateRetestStatus(finding, currentIds, offline);
    return {
      ...finding,
      status: retestStatus,
      retest_status: retestStatus,
    };
  });
}

function evaluateRetestStatus(
  finding: HealthFinding,
  currentIds: Set<string>,
  offline: boolean,
): HealthRetestStatus {
  if (finding.requires_network && offline) {
    return 'needs-manual-verification';
  }
  return currentIds.has(finding.id) ? 'still-open' : 'fixed';
}

export interface RetestReportInput {
  now: Date;
  offline: boolean;
  source: HealthReportIndex;
  retestFindings: HealthRetestFinding[];
}

/** Assemble the retest report index (pure). Filenames follow `<orig-ts>-retest-<ts>`. */
export function buildRetestReportIndex(input: RetestReportInput): HealthReportIndex {
  const timestamp = toHealthTimestamp(input.now);
  const origTimestamp = input.source.report_id.replace(/^(?:HEALTH|RETEST)-/, '');
  const base = `${origTimestamp}-retest-${timestamp}`;
  const findings = sortFindings(input.retestFindings);
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    report_id: toHealthReportId('RETEST', input.now),
    workflow: 'health-retest',
    generated_at: input.now.toISOString(),
    report_path: toPosixPath(join(PATHS.HEALTH_DIR, `${base}.md`)),
    sidecar_path: toPosixPath(join(PATHS.HEALTH_DIR, `${base}.json`)),
    source_report_path: input.source.sidecar_path,
    source_report_id: input.source.report_id,
    offline: input.offline,
    stack: input.source.stack,
    tool_availability: input.source.tool_availability,
    findings,
    blocked_checks: input.source.blocked_checks,
    baseline: input.source.baseline,
    sources_used: input.source.sources_used,
    next_remediation_priorities: nextRemediationPriorities(findings),
    raw_evidence_paths: [],
  };
}
