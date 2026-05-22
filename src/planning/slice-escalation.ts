import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  SliceEscalationReason,
  SliceEscalationReport,
  SliceFixAttempt,
} from '@/core/types/planning.js';

import type { SliceGateDetail } from './slice-gate.js';

export function createSliceEscalationReport(input: {
  sliceId: string;
  reason: SliceEscalationReason;
  attempts: number;
  gate: SliceGateDetail;
  fixAttempts: SliceFixAttempt[];
  tokensConsumed: number;
  recommendation: string;
  blockedDownstream: string[];
}): SliceEscalationReport {
  return {
    slice_id: input.sliceId,
    escalation_reason: input.reason,
    attempts: input.attempts,
    failing_criteria: input.gate.criteria_checks
      .filter((check) => !check.passed)
      .map((check) => check.criterion_id),
    failing_tests: [
      ...input.gate.criteria_checks
        .filter((check) => !check.passed)
        .map((check) => ({
          test_file: check.proof_target ?? 'manual-check',
          test_name: check.criterion_id,
          error: check.detail,
        })),
      ...input.gate.full_suite_check.new_failures.map((failure) => ({
        test_file: failure,
        error: 'New full-suite failure',
      })),
    ],
    scope_violations: input.gate.scope_check.violations,
    regression_failures: input.gate.regression_checks
      .filter((check) => !check.passed)
      .map((check) => check.entry_id),
    fix_attempts: input.fixAttempts,
    tokens_consumed: input.tokensConsumed,
    recommendation: input.recommendation,
    blocked_downstream: input.blockedDownstream,
  };
}

export class SliceEscalationStore {
  async load(
    projectRoot: string,
    slug: string,
    sliceId: string,
  ): Promise<SliceEscalationReport | null> {
    const target = escalationReportPath(projectRoot, slug, sliceId);
    if (!existsSync(target)) {
      return null;
    }

    try {
      return JSON.parse(await readFile(target, 'utf8')) as SliceEscalationReport;
    } catch {
      return null;
    }
  }

  async save(projectRoot: string, slug: string, report: SliceEscalationReport): Promise<string> {
    const target = escalationReportPath(projectRoot, slug, report.slice_id);
    const temp = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temp, target);
    return target;
  }
}

export function escalationReportPath(projectRoot: string, slug: string, sliceId: string): string {
  return join(projectRoot, PATHS.PLANNING_SPECS_DIR, `${slug}.escalations`, `${sliceId}.json`);
}
