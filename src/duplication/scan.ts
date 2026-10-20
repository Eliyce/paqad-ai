import { appendDuplicationRun } from '@/feature-evidence/bundle-ledgers.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { armDecisionFromDuplicationFinding } from '@/planning/decision-evidence-arm.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { resolveDuplicationConfig, type DuplicationConfig } from './config.js';
import { detectNewCodeDuplication } from './detect.js';
import { applyResolvedDecisions, type ResolvedDuplicationDecision } from './decisions.js';
import {
  buildDuplicationReport,
  writeDuplicationReport,
  type DuplicationReport,
} from './report.js';

export interface ScanOptions {
  projectRoot: string;
  changedFiles?: string[];
  config?: DuplicationConfig;
  corroborate?: boolean;
  sessionId?: string | null;
  clock?: { nowIso: () => string; nowMs: () => number };
}

export async function runDuplicationScan(options: ScanOptions): Promise<DuplicationReport> {
  const config = options.config ?? resolveDuplicationConfig(options.projectRoot);
  const clock = options.clock ?? {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };

  const changedFiles =
    options.changedFiles ?? (await loadChangeEvidence(options.projectRoot)).files;

  const startedMs = clock.nowMs();
  const rawFindings = await detectNewCodeDuplication({
    projectRoot: options.projectRoot,
    changedFiles,
    config,
    corroborate: options.corroborate,
  });

  const resolved: ResolvedDuplicationDecision[] = applyResolvedDecisions(
    options.projectRoot,
    rawFindings,
  );
  const findings = resolved.length === 0 ? rawFindings : downgrade(rawFindings, resolved);
  const elapsedMs = Math.max(0, clock.nowMs() - startedMs);

  const report = buildDuplicationReport({
    findings,
    config,
    elapsedMs,
    now: clock.nowIso(),
    resolvedDecisions: resolved.map((entry) => entry.decisionId),
  });

  writeDuplicationReport(options.projectRoot, report);
  appendDuplicationRun(
    options.projectRoot,
    resolveSessionId(options.projectRoot, options.sessionId ?? null),
    report,
  );
  armStrongestBlockingFinding(options, findings);
  return report;
}

function armStrongestBlockingFinding(
  options: ScanOptions,
  findings: DuplicationReport['findings'],
): void {
  const blocking = findings.filter((finding) => finding.kind === 'deterministic');
  if (blocking.length === 0) {
    return;
  }
  const strongest = blocking.reduce((best, finding) =>
    finding.similarity > best.similarity ? finding : best,
  );
  try {
    const sessionId = resolveSessionId(options.projectRoot, options.sessionId ?? null);
    const changeKey = currentFeature(options.projectRoot, sessionId);
    if (!changeKey) {
      return;
    }
    armDecisionFromDuplicationFinding({
      projectRoot: options.projectRoot,
      changeKey,
      sessionId,
      finding: strongest,
    });
  } catch {}
}

function downgrade(
  findings: DuplicationReport['findings'],
  resolved: ResolvedDuplicationDecision[],
): DuplicationReport['findings'] {
  const covered = new Set(resolved.flatMap((entry) => entry.coveredFindingKeys));
  return findings.map((finding) => {
    const key = `${finding.file}:${finding.line_range.start}:${finding.matched_file}`;
    if (finding.kind === 'deterministic' && covered.has(key)) {
      return { ...finding, kind: 'heuristic' as const };
    }
    return finding;
  });
}
