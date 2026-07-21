// The machine-finding collector (issue #360).
//
// Review was the weakest stage in the pipeline: paqad proved a review FILE existed (it
// hashed the bytes) but the content was the model grading its own homework, with no hard
// facts in front of it. Meanwhile paqad had already computed those facts — rule findings,
// duplication findings, check verdicts, gate failures — and scattered them across four
// cached artifacts nothing ever composed.
//
// This module is the one place that unions them into a single row shape. Both consumers
// read it: the digest the model reads before writing findings, and the tightened
// `ImplementationReviewGate` that fails when a deterministic finding went unaddressed
// (D-01KY1TV1GFZ3CABQYWQR753XKT). Deriving the gate's rows here rather than parsing the
// written digest is what keeps the gate honest — skipping `review digest` cannot silently
// disarm it.
//
// Every read is a direct read of a known cached path (INV-1): no subprocess, no network,
// no filesystem scan. That is why the whole digest costs well under a second and zero
// model tokens. It also replaces `runtime/base/skills/adversarial-review/scripts/
// digest-evidence.sh`, whose gate-failure flattening is ported here in cross-platform
// Node — the shell script stays a skill resource, but it is no longer the engine.

import { readChecksReport } from '@/checks/report-store.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { formatRange } from '@/duplication/types.js';
import { readReport as readRuleScriptReport } from '@/rule-scripts/runner.js';
import { readVerificationEvidence } from '@/verification/evidence-markdown.js';

/**
 * How much weight a row carries. Mirrors the rule-script `Finding` severity vocabulary so
 * a rule finding passes through unchanged; the other three sources map onto it.
 */
export type MachineFindingSeverity =
  'critical' | 'blocker' | 'high' | 'medium' | 'low' | 'nit' | 'info';

/**
 * Whether a row is machine-proven or a judgement call the tooling is only suggesting.
 * `deterministic` rows are the ones the review must confirm or contest; `heuristic` rows
 * are context and never gate anything.
 */
export type MachineFindingTier = 'deterministic' | 'heuristic';

/** One machine-computed fact about this change, normalised across all four sources. */
export interface MachineFinding {
  /** Where the row came from, e.g. `rule:RL-6740`, `duplication`, `checks`, `gate:spec-review`. */
  source: string;
  severity: MachineFindingSeverity;
  tier: MachineFindingTier;
  /** Project-relative file the row anchors to, or null when the row has no location. */
  file: string | null;
  /** Line (or `12-40` span) within {@link file}, or null when unknown. */
  line: string | null;
  message: string;
}

/** The severity band a review is REQUIRED to address (INV-2). */
const HIGH_BAND: readonly MachineFindingSeverity[] = ['critical', 'blocker', 'high'];

/** Collapse whitespace and clip, so one row is always one readable line. */
function oneLine(message: string, max = 200): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** `file:line`, `file`, or null — the anchor a review has to mention to address a row. */
export function findingAnchor(finding: MachineFinding): string | null {
  if (finding.file === null) return null;
  return finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
}

/** Rule-script findings: the report already carries severity and tier per script. */
function ruleScriptRows(projectRoot: string): MachineFinding[] {
  const report = readRuleScriptReport(projectRoot);
  if (!report) return [];
  const rows: MachineFinding[] = [];
  for (const result of report.results) {
    for (const finding of result.findings) {
      rows.push({
        source: `rule:${result.rule_id}`,
        severity: finding.severity,
        tier: result.kind,
        file: finding.file,
        line: finding.line === undefined ? null : String(finding.line),
        message: oneLine(finding.message),
      });
    }
  }
  return rows;
}

/**
 * Duplication findings (issue #358). The detector bands its findings itself — at or above
 * the similarity threshold is `deterministic` (blocking-capable in strict mode), the
 * 0.80–0.90 band is `heuristic` and routes to review. That band IS the severity here, so
 * a deterministic near-copy is a row the review must speak to and a heuristic one is not.
 */
function duplicationRows(projectRoot: string): MachineFinding[] {
  const report = readDuplicationReport(projectRoot);
  if (!report) return [];
  return report.findings.map((finding) => ({
    source: 'duplication',
    severity: finding.kind === 'deterministic' ? ('high' as const) : ('medium' as const),
    tier: finding.kind,
    file: finding.file,
    line: formatRange(finding.line_range),
    message: oneLine(finding.message),
  }));
}

/**
 * The check verdict (issue #318). One row per executed command, plus one row per recorded
 * failure. Check rows are deliberately anchor-less at the command level: a red `test`
 * command is not something a review "addresses" by citing a line, so it informs the
 * reviewer without ever becoming an anchoring obligation (INV-2).
 */
function checksRows(projectRoot: string): MachineFinding[] {
  const report = readChecksReport(projectRoot);
  if (!report) return [];
  const rows: MachineFinding[] = [];
  for (const result of report.results) {
    const runner = result.summary.runner_id;
    const failed = result.summary.failed + result.summary.errored;
    rows.push({
      source: 'checks',
      severity: failed > 0 ? 'high' : 'info',
      tier: 'deterministic',
      file: null,
      line: null,
      message: oneLine(
        failed > 0
          ? `${runner}: ${failed} failing of ${result.summary.total}`
          : `${runner}: ${result.summary.passed} passing of ${result.summary.total}`,
      ),
    });
    for (const failure of result.failures) {
      rows.push({
        source: `checks:${runner}`,
        severity: 'high',
        tier: 'deterministic',
        file: failure.file_path,
        line: failure.line_number === null ? null : String(failure.line_number),
        message: oneLine(`${failure.test_id}: ${failure.message}`),
      });
    }
  }
  return rows;
}

/**
 * Failing verification gates, flattened one failure per row — the job
 * `digest-evidence.sh` did in shell, ported here. A gate that failed with no itemised
 * failures still contributes its own row, so "the gate is red" is never lost just because
 * the gate did not enumerate why. This is also where unresolved doc targets surface: the
 * canonical-docs gate records them as its failures.
 */
function gateRows(projectRoot: string): MachineFinding[] {
  const evidence = readVerificationEvidence(projectRoot);
  if (!evidence) return [];
  const rows: MachineFinding[] = [];
  for (const gate of evidence.gates) {
    if (gate.status !== 'fail' && gate.status !== 'inconclusive') continue;
    const severity: MachineFindingSeverity = gate.status === 'fail' ? 'high' : 'medium';
    if (gate.failures.length === 0) {
      rows.push({
        source: `gate:${gate.name}`,
        severity,
        tier: 'deterministic',
        file: null,
        line: null,
        message: oneLine(gate.detail),
      });
      continue;
    }
    for (const failure of gate.failures) {
      rows.push({
        source: `gate:${gate.name}`,
        severity,
        tier: 'deterministic',
        file: failure.file,
        line: failure.line === null ? null : String(failure.line),
        message: oneLine(failure.ac_id ? `${failure.ac_id}: ${failure.message}` : failure.message),
      });
    }
  }
  return rows;
}

/**
 * Every machine-computed finding on record for this change, in a fixed source order so the
 * digest is stable between runs. A source that is absent, empty, or unparseable
 * contributes zero rows and never throws (FR-2) — each underlying reader already degrades
 * to `null` on a corrupt file, which is exactly the "no report ⇒ nothing proven" posture
 * the rest of the framework takes.
 */
export function collectMachineFindings(projectRoot: string): MachineFinding[] {
  return [
    ...ruleScriptRows(projectRoot),
    ...duplicationRows(projectRoot),
    ...checksRows(projectRoot),
    ...gateRows(projectRoot),
  ];
}

/**
 * The rows a review is obliged to speak to: deterministic, file-anchored, and in the
 * high band. Everything else is context — a heuristic near-copy, a passing check, an
 * anchor-less gate verdict — and can never make a review fail (INV-2).
 */
export function anchoringFindings(findings: MachineFinding[]): MachineFinding[] {
  return findings.filter(
    (finding) =>
      finding.tier === 'deterministic' &&
      HIGH_BAND.includes(finding.severity) &&
      findingAnchor(finding) !== null,
  );
}

/**
 * The anchoring rows whose `file:line` appears nowhere in `reviewText` — the machine
 * findings the review ignored. String containment is the whole test (issue #360, v1): it
 * asks only "did the reviewer look at this place?", never "is the prose any good", which
 * keeps the gate deterministic and un-arguable. An empty `reviewText` (no review recorded
 * yet) means every anchoring row is unaddressed, which is the honest reading.
 */
export function unanchoredMachineFindings(
  findings: MachineFinding[],
  reviewText: string,
): MachineFinding[] {
  return anchoringFindings(findings).filter((finding) => {
    const anchor = findingAnchor(finding);
    return anchor !== null && !reviewText.includes(anchor);
  });
}
