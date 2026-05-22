/**
 * FR-DP1: Defect Recording
 *
 * Converts integrity-system outputs into DefectFinding records and persists
 * them via the pattern store. Recording is automatic and adds < 100ms latency
 * (NFR-DP1) because it fires after the gate/report has already returned.
 */

import type { ComplianceReport } from '../types.js';
import { classifyDefect } from './classifier.js';
import { recordFindings } from './store.js';
import type { DefectFinding, StackContext } from './types.js';

export interface RecordFromComplianceOptions {
  report: ComplianceReport;
  stack_context?: StackContext;
  storeRoot?: string;
}

/**
 * Record uncovered obligation defects from a compliance report (FR-DP1.1 source: compliance).
 * Returns the number of findings recorded.
 */
export async function recordFromComplianceReport(
  options: RecordFromComplianceOptions,
): Promise<number> {
  const { report } = options;
  const stackContext: StackContext = options.stack_context ?? { frameworks: [], traits: [] };
  const now = new Date().toISOString();

  const findings: DefectFinding[] = report.obligations
    .filter((o) => o.state === 'uncovered')
    .map((obligation): DefectFinding => {
      const subcategory = classifyDefect(obligation.description, 'D5');
      return {
        defect_id: `${report.metadata.spec_file}:${obligation.obligation_id}`,
        source: 'compliance',
        category: 'D5',
        subcategory,
        spec_file: report.metadata.spec_file,
        obligation_id: obligation.obligation_id,
        stack_context: stackContext,
        description: obligation.description,
        file_path: null,
        recorded_at: now,
        resolved: false,
        recurrence_count: 1,
      };
    });

  if (findings.length > 0) {
    await recordFindings(findings, options.storeRoot);
  }
  return findings.length;
}
