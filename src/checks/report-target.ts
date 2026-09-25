// Active-feature resolution for the check report (issue #528).
//
// The structured check report is re-homed from the global tracked `.paqad/checks/last-run.json`
// into the change's per-feature bundle (`.paqad/ledger/feature-evidence/<change>/checks.json`).
// This module is the ONE place that decides where a report goes and where it is read from, so
// the writer (`paqad-ai checks run`) and both readers (the completion backstop, the review
// digest) share identical bundle-vs-global fallback logic instead of each re-deriving it.
//
// The rule is simple: when a feature bundle is active, use the bundle; otherwise (a
// non-feature-development / chat session, with no active bundle) fall back to the global path.
// A bundle read that comes back empty also falls back to the global path, so a report written
// before a bundle opened is never lost. Every step is defensive — a resolution fault degrades
// to the global path, never a throw.

import {
  type ChecksReport,
  readChecksReport,
  readFeatureChecks,
  writeChecksReport,
  writeFeatureChecks,
} from '@/checks/report-store.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

/**
 * The active feature bundle dir for this session, or null when none is open. Distinct from
 * `resolveActiveFeature` (which MINTS a bundle when none is active): this must return null for a
 * non-feature-development / chat session so the caller falls back to the global path rather than
 * opening a bundle for a chat turn. Best-effort: any fault reads as "no active feature".
 */
export function activeFeatureDirOrNull(projectRoot: string): string | null {
  try {
    return currentFeature(projectRoot, checksSessionId(projectRoot));
  } catch {
    return null;
  }
}

/** The session the checks verbs run under, the one {@link activeFeatureDirOrNull} resolves. */
function checksSessionId(projectRoot: string): string {
  return resolveSessionId(projectRoot, process.env.CLAUDE_SESSION_ID ?? null);
}

/**
 * Read the check report for a change: from the active feature bundle when `dirName` is set (with
 * a global-path fall back when the bundle carries none), else from the global path. Callers that
 * already resolved the active feature (the completion backstop) pass their `dirName`; callers
 * that have not (the review digest) pass `activeFeatureDirOrNull(projectRoot)`.
 */
export function readChecksReportForFeature(
  projectRoot: string,
  dirName: string | null,
): ChecksReport | null {
  if (dirName) {
    const fromBundle = readFeatureChecks(projectRoot, dirName);
    if (fromBundle) return fromBundle;
  }
  return readChecksReport(projectRoot);
}

/**
 * Write the check report for a change: into the active feature bundle when `dirName` is set, else
 * to the global fallback path (a non-feature-development / chat session with no active bundle).
 */
export function writeChecksReportForFeature(
  projectRoot: string,
  dirName: string | null,
  report: ChecksReport,
): string {
  return dirName
    ? writeFeatureChecks(projectRoot, dirName, report, checksSessionId(projectRoot))
    : writeChecksReport(projectRoot, report);
}
