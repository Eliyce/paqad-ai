// The duplication scan runner (issue #358) — detect, apply the resolved-decision escape hatch,
// cache the report, and fold telemetry onto the session ledger.
//
// This is the one function both bindings call: the `duplication scan` CLI verb (which the armed
// rule-script shells out to) and any in-process caller. Keeping detection, decision-filtering,
// caching, and telemetry in one place means the checks-stage rule-script and the Stop-seam gate
// always read a single, consistent report.

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { armDecisionFromDuplicationFinding } from '@/planning/decision-evidence-arm.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { resolveDuplicationConfig, type DuplicationConfig } from './config.js';
import { detectNewCodeDuplication } from './detect.js';
import { applyResolvedDecisions, type ResolvedDuplicationDecision } from './decisions.js';
import {
  buildDuplicationReport,
  recordDuplicationRun,
  writeDuplicationReport,
  type DuplicationReport,
} from './report.js';

export interface ScanOptions {
  projectRoot: string;
  /** Changed files to scope to; resolved from change-evidence when omitted. */
  changedFiles?: string[];
  /** Resolved config; defaults to the project's resolved duplication config. */
  config?: DuplicationConfig;
  /** Run jscpd corroboration (default true). */
  corroborate?: boolean;
  /** Session whose active feature identifies the change being armed (issue #361). */
  sessionId?: string | null;
  /** Clock injection for a deterministic `generated_at` / elapsed measure in tests. */
  clock?: { nowIso: () => string; nowMs: () => number };
}

/**
 * Run the full duplication scan and return the cached report. Detection is new-code-only and
 * pure; a resolved `create-vs-reuse` decision downgrades its matched finding out of the blocking
 * band (AC-5); the report is written to the cache the gate reads; and the run's counts fold onto
 * the session ledger (FR-11). Never throws — a degraded run reports zero findings.
 */
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
  recordDuplicationRun(options.projectRoot, report);
  armStrongestBlockingFinding(options, findings);
  return report;
}

/**
 * Issue #361 — a blocking-band finding IS the create-vs-reuse question with its evidence
 * already attached, so open the pause the #358 escape hatch expects instead of leaving the
 * developer to write the packet by hand. Only the strongest finding is offered; the arming
 * layer applies the mode, the per-change cap, and the prior-answer check. Best-effort: a
 * scan never fails because a pause could not be opened.
 */
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
  } catch {
    /* best-effort: arming never breaks a scan (INV-4) */
  }
}

/**
 * Downgrade every finding a resolved decision covers from `deterministic` to `heuristic`, so it
 * surfaces in the report but no longer blocks. The matched decisions are recorded on the report
 * so the receipt can name the id (AC-5).
 */
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
