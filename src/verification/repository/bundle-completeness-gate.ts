import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { VerificationGate, VerificationOrigin } from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendRuleRun,
} from '@/feature-evidence/bundle-ledgers.js';
import {
  documentHashMatches,
  rowHashMatches,
  splitFrontMatter,
  textHashMatches,
} from '@/feature-evidence/envelope.js';
import { readFeatureRecord, featureRecordIsUntitled } from '@/feature-evidence/feature-record.js';
import {
  BUNDLE_MANIFEST,
  FAST_LANE_REFREEZE_HINT,
  isBundleFileRequired,
  isSpecFrozenOnFastLane,
  specPipelineStrictApplies,
  validateBundleFileContent,
  validateSpecificationAdoption,
  type BundleCompletenessConfig,
  type BundleManifestEntry,
} from '@/feature-evidence/manifest.js';
import {
  FEATURE_BUNDLE_FILES,
  chatRagPath,
  featureFilePath,
  featureLegacySpecMarkdownPath,
  featureReportPath,
  type FeatureBundleFile,
} from '@/feature-evidence/paths.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { hasStageAgentEvidence } from '@/stage-isolation/isolation-summary.js';
import { readDrift } from '@/rule-scripts/reconciler.js';
import { readReport, ruleRunFindings } from '@/rule-scripts/runner.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BundleCompletenessMode } from './bundle-completeness-mode.js';

function readFileSafe(projectRoot: string, rel: string): string | null {
  try {
    return readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

const GATE_NAME = 'bundle-completeness' as VerificationGate;

const RECOVERABLE = new Set<FeatureBundleFile>(['ruleRun', 'duplication', 'changeMetrics']);

const LOCAL_ORIGINS: ReadonlySet<VerificationOrigin> = new Set(['hook-completion', 'git-backstop']);

export interface BundleCompletenessGateInput {
  projectRoot: string;
  sessionId: string;
  dirName: string | null;
  mode: BundleCompletenessMode;
  origin: VerificationOrigin;
  isFeatureDev: boolean;
  config: BundleCompletenessConfig;
  changeMetrics: ChangeMetrics | null;
  evidenceRowsPending?: boolean;
  receiptPending?: boolean;
}

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

function backfill(entry: BundleManifestEntry, input: BundleCompletenessGateInput): boolean {
  const { projectRoot, sessionId } = input;
  if (entry.key === 'ruleRun') {
    let minted = false;
    const report = readReport(projectRoot);
    if (report) {
      appendRuleRun(projectRoot, sessionId, {
        kind: 'findings',
        counts: report.counts as unknown as Record<string, number>,
        blocking: report.blocking,
        findings: ruleRunFindings(report),
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
  laneSkipped: string[];
  preSwitchSkipped: string[];
  isolationUnverified: boolean;
}

export function bundleCompletenessGate(
  input: BundleCompletenessGateInput,
): VerificationEvidenceGate | null {
  if (input.mode === 'off') {
    return null;
  }
  const { dirName, sessionId } = input;
  if (!input.isFeatureDev || !dirName) {
    return skipped(
      'No active feature bundle for this change — bundle-completeness check not applicable.',
    );
  }
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
    laneSkipped: [],
    preSwitchSkipped: [],
    isolationUnverified: false,
  };

  try {
    for (const entry of BUNDLE_MANIFEST) {
      if (entry.required === 'optional') {
        const content = readBundleFile(input.projectRoot, dirName, entry);
        if (validateBundleFileContent(entry.validate, content)) {
          if (!recordHashMismatch(entry, content!, state)) state.present.push(entry.file);
        }
        continue;
      }
      if (!isBundleFileRequired(entry, input.config)) {
        const unlocked = {
          ...input.config,
          lane: 'full' as const,
          specFrozenBeforePipeline: false,
        };
        if (!isBundleFileRequired(entry, unlocked)) {
          state.flagSkipped.push(entry.file);
        } else if (input.config.lane === 'fast') {
          state.laneSkipped.push(entry.file);
        } else {
          state.preSwitchSkipped.push(entry.file);
        }
        continue;
      }
      assertRequired(entry, input, dirName, sessionId, state);
    }
    assertStageAgentRows(input, dirName, state);
    /* v8 ignore next 4 -- best-effort: a read/backfill fault must never change the verdict;
       a filesystem fault is not reproduced in tests. */
  } catch {}

  return decide(input.mode, state);
}

export function recheckAfterReceiptSeal(
  gate: VerificationEvidenceGate | null,
  input: BundleCompletenessGateInput,
  sealed: boolean,
): VerificationEvidenceGate | null {
  if (sealed || gate === null || input.receiptPending !== true) {
    return gate;
  }
  return bundleCompletenessGate({ ...input, receiptPending: false });
}

function assertStageAgentRows(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  if (hasStageAgentEvidence(input.projectRoot, dirName)) return;
  if (input.config.stageIsolationExpected) {
    state.missing.push({
      file: 'stage-agent rows in stage-evidence.jsonl',
      writer: 'dispatch each stage to its paqad-<stage> agent; the SubagentStop hook records it',
    });
    return;
  }
  if (input.config.stageIsolationUnresolved) {
    state.isolationUnverified = true;
  }
}

function assertRequired(
  entry: BundleManifestEntry,
  input: BundleCompletenessGateInput,
  dirName: string,
  sessionId: string,
  state: GateState,
): void {
  const content = readBundleFile(input.projectRoot, dirName, entry);
  if (validateBundleFileContent(entry.validate, content)) {
    if (entry.key === 'feature') {
      const record = readFeatureRecord(input.projectRoot, dirName);
      if (record && featureRecordIsUntitled(record)) {
        state.missing.push({
          file: `${entry.file} (no title and no ticket)`,
          writer:
            'paqad-ai plan compile (the plan title names the change), or stage start planning --title',
        });
        return;
      }
    }
    if (entry.key === 'specMd' && !specSourceMatches(input.projectRoot, dirName, content!)) {
      state.missing.push({
        file: `${entry.file} (its body does not hash to specification.json spec_hash)`,
        writer: 'paqad-ai spec freeze (re-freeze the spec)',
      });
      return;
    }
    if (entry.key === 'specification') {
      if (specPipelineStrictApplies(input.config)) {
        const adoption = validateSpecificationAdoption(content);
        if (!adoption.ok) {
          state.missing.push({
            file: adoption.error!,
            writer: 'paqad-ai spec freeze --from-pipeline (or --manual --reason)',
          });
          return;
        }
      }
    }
    if (recordHashMismatch(entry, content!, state)) return;
    state.present.push(entry.file);
    return;
  }

  if (entry.key === 'specMd' && legacySpecProjectionPresent(input.projectRoot, dirName)) {
    state.present.push(entry.file);
    return;
  }

  if (entry.key === 'evidence' && input.evidenceRowsPending) {
    state.present.push(entry.file);
    return;
  }

  if ((entry.key === 'receipt' || entry.key === 'aiBom') && input.receiptPending) {
    state.present.push(entry.file);
    return;
  }

  if (entry.unrecoverable) {
    const chat = readFileSafe(input.projectRoot, chatRagPath(sessionId));
    if (validateBundleFileContent(entry.validate, chat)) {
      state.present.push(entry.file);
    } else {
      state.ragMissing = true;
    }
    return;
  }

  if (RECOVERABLE.has(entry.key as FeatureBundleFile) && backfill(entry, input)) {
    state.backfilled.push(entry.file);
    return;
  }

  const refreeze =
    PIPELINE_FILE_KEYS.has(entry.key) &&
    isSpecFrozenOnFastLane(readSpecificationRecord(input.projectRoot, dirName));
  state.missing.push({
    file: entry.file,
    writer: refreeze ? FAST_LANE_REFREEZE_HINT : entry.writer,
  });
}

const PIPELINE_FILE_KEYS: ReadonlySet<BundleManifestEntry['key']> = new Set([
  'request',
  'clarification',
  'experts',
]);

function contentHashMismatch(entry: BundleManifestEntry, content: string): string | null {
  if (entry.key === 'report') return null;
  if (entry.validate === 'nonempty') {
    return textHashMatches(content) === false ? 'its body' : null;
  }
  if (entry.validate === 'json') {
    return documentHashMatches(JSON.parse(content)) === false ? 'the document' : null;
  }
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (rowHashMatches(row) === false) return `line ${index + 1}`;
  }
  return null;
}

function recordHashMismatch(
  entry: BundleManifestEntry,
  content: string,
  state: GateState,
): boolean {
  const where = contentHashMismatch(entry, content);
  if (where === null) return false;
  state.missing.push({
    file: `${entry.file} (content_hash mismatch at ${where}: changed outside its writer)`,
    writer: entry.writer,
  });
  return true;
}

function readSpecificationRecord(
  projectRoot: string,
  dirName: string,
): { spec_file?: unknown; spec_hash?: unknown } | null {
  const text = readFileSafe(projectRoot, featureFilePath(dirName, 'specification'));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function specSourceMatches(projectRoot: string, dirName: string, specMd: string): boolean {
  const record = readSpecificationRecord(projectRoot, dirName);
  if (typeof record?.spec_hash !== 'string') return true;
  return sha256Hex(splitFrontMatter(specMd).body) === record.spec_hash;
}

function legacySpecProjectionPresent(projectRoot: string, dirName: string): boolean {
  const record = readSpecificationRecord(projectRoot, dirName);
  if (typeof record?.spec_file !== 'string' || record.spec_file === FEATURE_BUNDLE_FILES.specMd) {
    return false;
  }
  const md = readFileSafe(projectRoot, featureLegacySpecMarkdownPath(dirName));
  return md !== null && md.trim().length > 0;
}

function decide(mode: BundleCompletenessMode, state: GateState): VerificationEvidenceGate {
  const skipNote =
    (state.flagSkipped.length > 0
      ? ` Skipped (flag off): ${[...state.flagSkipped].sort().join(', ')}.`
      : '') +
    (state.laneSkipped.length > 0
      ? ` Not required on the fast lane: ${[...state.laneSkipped].sort().join(', ')}.`
      : '') +
    (state.preSwitchSkipped.length > 0
      ? ` Spec frozen before the spec pipeline was on, so not required: ${[...state.preSwitchSkipped].sort().join(', ')}.`
      : '');
  const backfillNote =
    state.backfilled.length > 0
      ? ` Backfilled (live write missed): ${state.backfilled.join(', ')}.`
      : '';

  if (state.missing.length > 0) {
    const named = state.missing.map((m) => `${m.file} (run: ${m.writer})`).join('; ');
    const detail = `The feature bundle is incomplete — missing/invalid: ${named}.${backfillNote}${skipNote}`;
    const remediation = `Produce the missing bundle file(s): ${named}.`;
    if (mode === 'strict') {
      return { name: GATE_NAME, status: 'fail', detail, remediation, failures: [] };
    }
    return { name: GATE_NAME, status: 'inconclusive', detail, remediation, failures: [] };
  }

  if (state.backfilled.length > 0 || state.ragMissing || state.isolationUnverified) {
    const ragNote = state.ragMissing
      ? ' rag.jsonl is absent (no bundle or _chat retrieval row); RAG evidence is unrecoverable.'
      : '';
    const isolationNote = state.isolationUnverified
      ? ' Not classified — isolation not verified: this change never resolved a lane, so paqad ' +
        'could not confirm its stages ran isolated. Set the real lane with `paqad-ai lane set ' +
        '<lane>` (isolation is checked on the graduated/full lane).'
      : '';
    return {
      name: GATE_NAME,
      status: 'inconclusive',
      detail: `Bundle present but not fully live-recorded.${backfillNote}${ragNote}${isolationNote}${skipNote}`,
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
  return {
    name: GATE_NAME,
    status: 'skipped',
    detail,
    remediation: null,
    failures: [],
    skip_kind: 'not-required',
  };
}
