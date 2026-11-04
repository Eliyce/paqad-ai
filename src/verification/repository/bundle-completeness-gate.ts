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
import { listInFlightFeatures } from '@/feature-evidence/adoption.js';
import { readFeatureRecord, featureRecordIsUntitled } from '@/feature-evidence/feature-record.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
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
import { agentCompletionFindings, skillCompletionFindings } from '@/authoring/completion.js';
import {
  AGENT_RECORD_WRITER,
  agentRecordFilename,
  SKILL_RECORD_WRITER,
  skillRecordFilename,
} from '@/feature-evidence/artifacts.js';
import { checkStageChain, firstChainBreakLine } from '@/feature-evidence/ledger-chain.js';
import { bundleLedgerEra, stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { RECIPE_INJECTED_KIND, SKILL_USED_KIND, STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import { recipeHasScript } from '@/stage-isolation/recipes.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';
import { readDuplicationReport } from '@/duplication/report.js';
import {
  hasStageAgentEvidence,
  hasStageAgentEvidenceSince,
} from '@/stage-isolation/isolation-summary.js';
import { readDrift } from '@/rule-scripts/reconciler.js';
import { readReport, ruleRunFindings } from '@/rule-scripts/runner.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

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
  changedFiles?: readonly string[];
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
  skillLines: string[];
  splitNote: string;
  chainNote: string;
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
    skillLines: [],
    splitNote: '',
    chainNote: '',
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
    assertRecipeProof(input, dirName, state);
    assertSkillRecords(input, dirName, state);
    assertAgentRecords(input, dirName, state);
    assertNotSplit(input, dirName, state);
    assertLedgerChain(input, dirName, state);
    /* v8 ignore start -- best-effort: a read/backfill fault must never change the verdict;
       a filesystem fault is not reproduced in tests. */
  } catch {}

  return decide(input.mode, state);
  /* v8 ignore stop */
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

const THINKING_STAGES: ReadonlySet<string> = new Set(['planning', 'specification', 'review']);

function holdsRecordedWork(rows: readonly SessionLedgerRow[], sessionId?: string): boolean {
  return rows.some(
    (row) =>
      (sessionId === undefined || row.session_id === sessionId) &&
      (row.stage === 'development' ||
        (row.kind === 'stage_end' &&
          typeof row.stage === 'string' &&
          THINKING_STAGES.has(row.stage) &&
          typeof row.artifact_digest === 'string')),
  );
}

function assertNotSplit(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  if (holdsRecordedWork(readFeatureStageUnit(input.projectRoot, dirName))) return;
  const others = listInFlightFeatures(input.projectRoot).filter(
    (other) =>
      other !== dirName &&
      holdsRecordedWork(readFeatureStageUnit(input.projectRoot, other), input.sessionId),
  );
  if (others.length === 0) return;
  state.splitNote =
    ` This session also has unfinished work in ${others.join(', ')}, which this check did not ` +
    `judge, so ${dirName} may hold only part of the change. Go back to that work with ` +
    `\`paqad-ai resume --feature ${others[0]}\`.`;
}

function assertLedgerChain(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  const raw = readFileSafe(input.projectRoot, featureFilePath(dirName, 'stageEvidence'));
  if (raw === null) return;
  const check = checkStageChain(raw);
  const breakLine = firstChainBreakLine(check);
  const era = bundleLedgerEra(readFeatureStageUnit(input.projectRoot, dirName));
  const warnings = [...check.gaps];
  if (breakLine !== null && era === 'v3') {
    state.skillLines.push(`${breakLine}: a row was removed, reordered or edited by hand.`);
    state.missing.push({
      file: 'stage-evidence.jsonl',
      writer: 'restore the ledger from git or add a `record-repair` row naming what happened',
    });
  } else if (breakLine !== null) {
    warnings.push(`${breakLine} in a ledger from before the chain`);
  }
  if (warnings.length > 0) state.chainNote += ` Ledger note: ${warnings.join('; ')}.`;
}

function assertSkillRecords(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  if (!input.changedFiles || input.changedFiles.length === 0) return;
  for (const finding of skillCompletionFindings({
    projectRoot: input.projectRoot,
    dirName,
    changedFiles: input.changedFiles,
  })) {
    state.missing.push({ file: skillRecordFilename(finding.skill), writer: SKILL_RECORD_WRITER });
    state.skillLines.push(finding.line);
  }
}

function assertAgentRecords(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  if (!input.changedFiles || input.changedFiles.length === 0) return;
  for (const finding of agentCompletionFindings({
    projectRoot: input.projectRoot,
    dirName,
    changedFiles: input.changedFiles,
  })) {
    const file = agentRecordFilename(finding.agent);
    if (!state.missing.some((entry) => entry.file === file)) {
      state.missing.push({ file, writer: AGENT_RECORD_WRITER });
    }
    if (!state.skillLines.includes(finding.line)) state.skillLines.push(finding.line);
  }
}

function assertStageAgentRows(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  const since = input.config.stageIsolationSince;
  if (
    since === undefined
      ? hasStageAgentEvidence(input.projectRoot, dirName)
      : hasStageAgentEvidenceSince(input.projectRoot, dirName, since)
  ) {
    return;
  }
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

function stageAgentRan(rows: readonly SessionLedgerRow[], stage: string): boolean {
  return rows.some(
    (row) =>
      row.kind === STAGE_AGENT_KIND &&
      row.event_status === 'completed' &&
      (row.stage === stage || (Array.isArray(row.stages) && row.stages.includes(stage))),
  );
}

function hasRowOf(rows: readonly SessionLedgerRow[], kind: string, stage: string): boolean {
  return rows.some((row) => row.kind === kind && row.stage === stage);
}

function codexChecksProven(rows: readonly SessionLedgerRow[]): boolean {
  return rows.some(
    (row) =>
      row.kind === 'stage_end' && row.stage === 'checks' && typeof row.artifact_digest === 'string',
  );
}

function missingProof(
  rows: readonly SessionLedgerRow[],
  stage: string,
  codex: boolean,
): string | null {
  if (!stageAgentRan(rows, stage)) return 'a stage-agent completed row';
  if (codex && stage === 'checks') {
    return codexChecksProven(rows) ? null : 'an end row with the digest of checks.json';
  }
  if (!codex && !hasRowOf(rows, RECIPE_INJECTED_KIND, stage)) return 'a recipe-injected row';
  if (recipeHasScript(stage) && !hasRowOf(rows, SKILL_USED_KIND, stage)) return 'a skill-used row';
  return null;
}

function startedBeforeLaneRaise(
  rows: readonly SessionLedgerRow[],
  stage: string,
  raisedAt: number,
): boolean {
  if (Number.isNaN(raisedAt)) return false;
  const started = rows.filter((row) => row.kind === 'stage_start' && row.stage === stage).at(-1);
  const at = Date.parse(String(started?.recorded_at ?? ''));
  return !Number.isNaN(at) && at < raisedAt;
}

function assertRecipeProof(
  input: BundleCompletenessGateInput,
  dirName: string,
  state: GateState,
): void {
  if (!input.config.stageIsolationExpected || input.config.lane !== 'full') return;
  const rows = readFeatureStageUnit(input.projectRoot, dirName);
  const record = readFeatureRecord(input.projectRoot, dirName);
  const codex = record?.adapter === 'codex-cli';
  const raised = record?.lane_raised;
  const raisedAt = raised?.to === 'full' ? Date.parse(raised.at) : Number.NaN;
  const older: string[] = [];
  for (const stage of STAGE_AGENT_STAGES) {
    if (!hasRowOf(rows, 'stage_start', stage)) continue;
    if (startedBeforeLaneRaise(rows, stage, raisedAt)) continue;
    if (stageLedgerEra(rows, stage) !== 'v3') {
      older.push(stage);
      continue;
    }
    const missing = missingProof(rows, stage, codex);
    if (missing === null) continue;
    state.skillLines.push(
      `The ${stage} stage has no proof its recipe was used: ${missing} is missing.`,
    );
    state.missing.push({
      file: `recipe proof for ${stage}`,
      writer: `dispatch the paqad-${stage.replace(/_/g, '-')} agent and end the stage with its command`,
    });
  }
  if (older.length > 0) {
    state.chainNote += ` These stages ran before the update and hold no recipe proof: ${older.join(', ')}.`;
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
            'paqad-ai feature title "<what this change builds>" (titles this bundle in place)',
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
    const skillNote = state.skillLines.length > 0 ? `${state.skillLines.join(' ')} ` : '';
    const detail = `${skillNote}The feature bundle is incomplete — missing/invalid: ${named}.${backfillNote}${state.splitNote}${skipNote}${state.chainNote}`;
    const remediation = `Produce the missing bundle file(s): ${named}.`;
    if (mode === 'strict') {
      return { name: GATE_NAME, status: 'fail', detail, remediation, failures: [] };
    }
    return { name: GATE_NAME, status: 'inconclusive', detail, remediation, failures: [] };
  }

  if (
    state.backfilled.length > 0 ||
    state.ragMissing ||
    state.isolationUnverified ||
    state.splitNote
  ) {
    const ragNote = state.ragMissing
      ? ' rag.jsonl is absent (no bundle or _chat retrieval row); RAG evidence is unrecoverable.'
      : '';
    const isolationNote = state.isolationUnverified
      ? ' Not classified — isolation not verified: this change never resolved a lane, so paqad ' +
        'could not confirm its stages ran isolated. Set the real lane with `paqad-ai lane set ' +
        '<lane>` (isolation is checked on the lanes in stage_isolation_lanes).'
      : '';
    const lead = state.splitNote
      ? 'Bundle present but the change may be split.'
      : 'Bundle present but not fully live-recorded.';
    return {
      name: GATE_NAME,
      status: 'inconclusive',
      detail: `${lead}${backfillNote}${ragNote}${isolationNote}${state.splitNote}${skipNote}${state.chainNote}`,
      remediation: null,
      failures: [],
    };
  }

  return {
    name: GATE_NAME,
    status: 'pass',
    detail: `Every required bundle file is present for this feature (${state.present.length} checked).${skipNote}${state.chainNote}`,
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
