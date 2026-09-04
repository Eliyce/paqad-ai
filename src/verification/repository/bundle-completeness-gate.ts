// The fail-closed bundle-completeness gate (issue #511, part B — RC-3).
//
// The successor to the warn-only evidence-existence gate. It reads the DECLARATIVE bundle
// manifest (src/feature-evidence/manifest.ts) — the single source of truth for which files
// a feature-development change must leave and who writes them — and, at end-of-change,
// asserts every required file exists AND validates. A required file that is missing, empty,
// or invalid FAILS the change under `strict` (the default), naming the file and its writer;
// under `warn` it surfaces as Inconclusive without blocking (the bake-in tier).
//
// It ABSORBS the existence gate's cache backfill as a RECOVERY step: a recoverable file
// (rule-run / duplication / change-metrics) missing from the live seam is minted from the
// engine caches — but reported `backfilled` (🟡), never a clean pass, so the recorder defect
// stays visible (AC-8). RAG is unrecoverable, so a genuine RAG gap is Inconclusive, never a
// hard fail. feature.json gets the extra AC-2 check: the placeholder title with no ticket is
// treated as missing (the change has no record of what it was).
//
// Scope is the SAME guard the existence gate uses: a non-feature-development / no-active-
// bundle / affirmatively-non-feature turn skips the whole gate (no regression of the
// #310/#390/#394 false-block fixes). Best-effort throughout: a read/backfill fault degrades
// to a note, never a throw and never a wrong verdict.

import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { VerificationGate, VerificationOrigin } from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendRuleRun,
} from '@/feature-evidence/bundle-ledgers.js';
import { readFeatureRecord, featureRecordIsUntitled } from '@/feature-evidence/feature-record.js';
import {
  BUNDLE_MANIFEST,
  isBundleFileRequired,
  validateBundleFileContent,
  type BundleCompletenessConfig,
  type BundleManifestEntry,
} from '@/feature-evidence/manifest.js';
import {
  chatRagPath,
  featureFilePath,
  featureReportPath,
  type FeatureBundleFile,
} from '@/feature-evidence/paths.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { readDrift } from '@/rule-scripts/reconciler.js';
import { readReport } from '@/rule-scripts/runner.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BundleCompletenessMode } from './bundle-completeness-mode.js';

/** Tolerant read of a project-relative file's raw bytes, or null when absent/unreadable. A
 *  single read + catch (never stat-then-read) avoids the TOCTOU race CodeQL flags. */
function readFileSafe(projectRoot: string, rel: string): string | null {
  try {
    return readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

/** The gate marker (not a registered VERIFICATION_GATES member, like `evidence-existence`). */
const GATE_NAME = 'bundle-completeness' as VerificationGate;

/** The recoverable files the gate can mint from the engine caches (marked `backfilled`). */
const RECOVERABLE = new Set<FeatureBundleFile>(['ruleRun', 'duplication', 'changeMetrics']);

/**
 * Origins where the local feature bundle is present, so its incompleteness can be enforced
 * (mirrors the stage-evidence gate's STAGE_EVIDENCE_HARD_ORIGINS). `ci-backstop` is excluded:
 * a fresh CI checkout has no committed local bundle, so the gate must never break it.
 */
const LOCAL_ORIGINS: ReadonlySet<VerificationOrigin> = new Set(['hook-completion', 'git-backstop']);

export interface BundleCompletenessGateInput {
  projectRoot: string;
  /** The session whose active feature bundle is checked/backfilled. */
  sessionId: string;
  /** The active feature bundle dir, or null when none is open / route is non-feature. */
  dirName: string | null;
  /** The resolved gate mode (`off` returns no gate). */
  mode: BundleCompletenessMode;
  /** The verification origin — only LOCAL origins can hard-fail (CI clones have no bundle). */
  origin: VerificationOrigin;
  /** Whether this change is feature-development (the gate only applies then). */
  isFeatureDev: boolean;
  /** The resolved config flags the manifest predicates read. */
  config: BundleCompletenessConfig;
  /** The live-computed metrics for this change, used to backfill change-metrics.jsonl. */
  changeMetrics: ChangeMetrics | null;
}

/** Read a bundle file's raw bytes (project-relative), or null when absent/unreadable. */
function readBundleFile(
  projectRoot: string,
  dirName: string,
  entry: BundleManifestEntry,
): string | null {
  const rel =
    entry.key === 'report'
      ? featureReportPath(dirName)
      : featureFilePath(dirName, entry.key as FeatureBundleFile);
  return readFileSafe(projectRoot, rel);
}

/** Attempt to mint a recoverable file from the engine caches. Returns whether it minted. */
function backfill(
  entry: BundleManifestEntry,
  input: BundleCompletenessGateInput,
): boolean {
  const { projectRoot, sessionId } = input;
  if (entry.key === 'ruleRun') {
    let minted = false;
    const report = readReport(projectRoot);
    if (report) {
      appendRuleRun(projectRoot, sessionId, {
        kind: 'findings',
        counts: report.counts as unknown as Record<string, number>,
        blocking: report.blocking,
        backfilled: true,
      });
      minted = true;
    }
    const drift = readDrift(projectRoot);
    if (drift) {
      appendRuleRun(projectRoot, sessionId, {
        kind: 'drift',
        counts: drift.counts,
        blocking: drift.blocked,
        backfilled: true,
      });
      minted = true;
    }
    return minted;
  }
  if (entry.key === 'duplication') {
    const report = readDuplicationReport(projectRoot);
    if (report) {
      appendDuplicationRun(projectRoot, sessionId, report, undefined, true);
      return true;
    }
    return false;
  }
  // change-metrics
  if (input.changeMetrics) {
    appendChangeMetrics(projectRoot, sessionId, input.changeMetrics, undefined, true);
    return true;
  }
  return false;
}

interface GateState {
  present: string[];
  backfilled: string[];
  missing: { file: string; writer: string }[];
  ragMissing: boolean;
  flagSkipped: string[];
}

/**
 * Run the bundle-completeness check for a change. Returns a
 * {@link VerificationEvidenceGate} (`pass` / `fail` / `inconclusive` / `skipped`), or `null`
 * when the knob is `off`. Side effect: mints any recoverable missing file from the caches
 * (best-effort, marked `backfilled`).
 */
export function bundleCompletenessGate(
  input: BundleCompletenessGateInput,
): VerificationEvidenceGate | null {
  if (input.mode === 'off') {
    return null;
  }
  const { dirName, sessionId } = input;
  // A non-feature / copy-only / chat turn (no active feature bundle) has no bundle to
  // complete — skipped, never a block (the #310/#390/#394 scope guard).
  if (!input.isFeatureDev || !dirName) {
    return skipped(
      'No active feature bundle for this change — bundle-completeness check not applicable.',
    );
  }
  // A non-local origin (CI) has no committed local bundle, so completeness is informational
  // there — skipped, never a block (mirrors the stage-evidence gate). The teeth are the
  // local Stop hook / git backstop.
  if (!LOCAL_ORIGINS.has(input.origin)) {
    return skipped(
      `Bundle-completeness is informational on ${input.origin} — no committed local bundle to check.`,
    );
  }

  const state: GateState = {
    present: [],
    backfilled: [],
    missing: [],
    ragMissing: false,
    flagSkipped: [],
  };

  try {
    for (const entry of BUNDLE_MANIFEST) {
      if (!isBundleFileRequired(entry, input.config)) {
        state.flagSkipped.push(entry.file);
        continue;
      }
      assertRequired(entry, input, dirName, sessionId, state);
    }
    /* v8 ignore next 4 -- best-effort: a read/backfill fault must never change the verdict;
       a filesystem fault is not reproduced in tests. */
  } catch {
    // Fall through to whatever was collected so far.
  }

  return decide(input.mode, state);
}

/** Check one required entry and record its outcome into `state`. */
function assertRequired(
  entry: BundleManifestEntry,
  input: BundleCompletenessGateInput,
  dirName: string,
  sessionId: string,
  state: GateState,
): void {
  const content = readBundleFile(input.projectRoot, dirName, entry);
  if (validateBundleFileContent(entry.validate, content)) {
    // feature.json exists + parses, but a placeholder title with no ticket means the change
    // has no record of what it was (issue #511, AC-2) — treat that as a missing record.
    if (entry.key === 'feature') {
      const record = readFeatureRecord(input.projectRoot, dirName);
      if (record && featureRecordIsUntitled(record)) {
        state.missing.push({
          file: `${entry.file} (no title and no ticket)`,
          writer: 'paqad-ai plan compile (the plan title names the change), or stage start planning --title',
        });
        return;
      }
    }
    state.present.push(entry.file);
    return;
  }

  // rag is unrecoverable: a genuine gap reads Inconclusive, never a hard fail. Present when
  // either home carries a row (the bundle, or the session `_chat` home — the one-prompt lag).
  if (entry.unrecoverable) {
    const chat = readFileSafe(input.projectRoot, chatRagPath(sessionId));
    if (validateBundleFileContent(entry.validate, chat)) {
      state.present.push(entry.file);
    } else {
      state.ragMissing = true;
    }
    return;
  }

  // Recoverable files: try to mint from the caches. A backfilled file is 🟡, never a pass.
  if (RECOVERABLE.has(entry.key as FeatureBundleFile) && backfill(entry, input)) {
    state.backfilled.push(entry.file);
    return;
  }

  state.missing.push({ file: entry.file, writer: entry.writer });
}

function decide(mode: BundleCompletenessMode, state: GateState): VerificationEvidenceGate {
  const skipNote =
    state.flagSkipped.length > 0
      ? ` Skipped (flag off): ${[...state.flagSkipped].sort().join(', ')}.`
      : '';
  const backfillNote =
    state.backfilled.length > 0
      ? ` Backfilled (live write missed): ${state.backfilled.join(', ')}.`
      : '';

  // A required, non-recoverable file is genuinely absent → the gate bites (strict) or
  // surfaces (warn). Names each missing file and the verb that produces it.
  if (state.missing.length > 0) {
    const named = state.missing.map((m) => `${m.file} (run: ${m.writer})`).join('; ');
    const detail =
      `The feature bundle is incomplete — missing/invalid: ${named}.${backfillNote}${skipNote}`;
    const remediation = `Produce the missing bundle file(s): ${named}.`;
    if (mode === 'strict') {
      return { name: GATE_NAME, status: 'fail', detail, remediation, failures: [] };
    }
    return { name: GATE_NAME, status: 'inconclusive', detail, remediation, failures: [] };
  }

  // No hard miss, but a backfill happened or RAG is unrecoverably absent → Inconclusive
  // (🟡), so a recovered-from-cache or dark-RAG bundle is never read as a clean pass (AC-8).
  if (state.backfilled.length > 0 || state.ragMissing) {
    const ragNote = state.ragMissing
      ? ' rag.jsonl is absent (no bundle or _chat retrieval row); RAG evidence is unrecoverable.'
      : '';
    return {
      name: GATE_NAME,
      status: 'inconclusive',
      detail: `Bundle present but not fully live-recorded.${backfillNote}${ragNote}${skipNote}`,
      remediation: null,
      failures: [],
    };
  }

  return {
    name: GATE_NAME,
    status: 'pass',
    detail: `Every required bundle file is present for this feature (${state.present.length} checked).${skipNote}`,
    remediation: null,
    failures: [],
  };
}

function skipped(detail: string): VerificationEvidenceGate {
  return { name: GATE_NAME, status: 'skipped', detail, remediation: null, failures: [] };
}
