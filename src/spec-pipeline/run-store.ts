import { mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';

import { dirname, join, relative, resolve } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { withFileLockSync } from '@/core/fs/file-lock.js';
import type { AgentRole } from '@/core/types/agent.js';
import type {
  SpecGroundingSection,
  SpecPipelineSection,
  SpecTaskSection,
  SpecTraceMap,
} from '@/core/types/feature-spec.js';
import { documentSessionId, stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import {
  buildTextHeader,
  ENVELOPE_HEADER_KEYS,
  renderFrontMatter,
  splitFrontMatter,
} from '@/feature-evidence/envelope.js';
import {
  featureChangeKey,
  featureFilePath,
  type FeatureBundleFile,
} from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import {
  CLARIFICATION_DOC_TYPE,
  EXPERTS_DOC_TYPE,
  FEATURE_DOC_SCHEMA_VERSION,
  REQUEST_DOC_TYPE,
} from '@/feature-evidence/types.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  SPEC_CORRECTION_KIND,
  SPEC_STEP_KIND,
  type SpecStepOutcome,
} from '@/stage-evidence/types.js';

import type { ExpertNotesArtifact } from './experts/notes.js';
import type { ExpertSynthesis } from './experts/synthesis.js';
import type {
  ExpertFinding,
  ExpertNeedArtifact,
  ExpertNote,
  ExpertOrigin,
  VoiceWarning,
} from './experts/types.js';
import { frozenPipelineSection, type QuestionCounts, type StagedFinish } from './finish.js';
import type {
  AutoAnswer,
  ClarityLabel,
  ClaritySignal,
  GroundingArtifact,
  LabelArtifact,
  PipelineQuestion,
  PipelineStep,
  QuestionsArtifact,
} from './types.js';

export const SPEC_PIPELINE_STAGING_DIR = '.paqad/tmp/spec-pipeline';

export const STAGED_FILES = {
  grounding: 'grounding.json',
  task: 'task.json',
  trace: 'trace.json',
  craft: 'spec.md',
  finish: 'finish.json',
  expertQuestions: 'expert-questions.json',
  inputs: 'inputs.json',
} as const;

export type StagedFile = keyof typeof STAGED_FILES;

export interface StoreWriteOptions {
  sessionId?: string | null;
  now?: () => Date;
}

export function stagingDir(dirName: string): string {
  return join(SPEC_PIPELINE_STAGING_DIR, featureChangeKey(dirName));
}

export function stagedFilePath(dirName: string, file: StagedFile): string {
  return join(stagingDir(dirName), STAGED_FILES[file]);
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function atomicWrite(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameWithRetrySync(tmp, abs);
}

export function readStagedText(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
): string | null {
  return readText(join(projectRoot, stagedFilePath(dirName, file)));
}

export function writeStagedText(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
  text: string,
): void {
  atomicWrite(join(projectRoot, stagedFilePath(dirName, file)), text);
}

export function readStagedJson<T>(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
): T | null {
  const raw = readStagedText(projectRoot, dirName, file);
  const parsed = raw === null ? undefined : parseJson(raw);
  return parsed === undefined ? null : (parsed as T);
}

export function writeStagedJson(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
  value: unknown,
): void {
  writeStagedText(projectRoot, dirName, file, `${JSON.stringify(value, null, 2)}\n`);
}

export function clearStaged(projectRoot: string, dirName: string, file: StagedFile): void {
  rmSync(join(projectRoot, stagedFilePath(dirName, file)), { force: true });
}

function readBundleBody(
  projectRoot: string,
  dirName: string,
  file: FeatureBundleFile,
): Record<string, unknown> | null {
  const raw = readText(join(projectRoot, featureFilePath(dirName, file)));
  const parsed = raw === null ? undefined : parseJson(raw);
  if (!isRecord(parsed)) return null;
  const body: Record<string, unknown> = { ...parsed };
  for (const key of ENVELOPE_HEADER_KEYS) delete body[key];
  return body;
}

function writeBundleBody(
  projectRoot: string,
  dirName: string,
  file: FeatureBundleFile,
  docType: string,
  body: Record<string, unknown>,
  options: StoreWriteOptions,
): void {
  const doc = stampFeatureDocument({
    projectRoot,
    dirName,
    docType,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    sessionId: options.sessionId,
    body,
    now: options.now,
  });
  atomicWrite(
    join(projectRoot, featureFilePath(dirName, file)),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
}

export function writeRequest(
  projectRoot: string,
  dirName: string,
  text: string,
  options: StoreWriteOptions = {},
): void {
  const header = buildTextHeader({
    docType: REQUEST_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: documentSessionId(projectRoot, dirName, options.sessionId),
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    body: text,
    now: options.now,
  });
  atomicWrite(
    join(projectRoot, featureFilePath(dirName, 'request')),
    renderFrontMatter(header, text),
  );
}

export function readRequest(projectRoot: string, dirName: string): string {
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'request')));
  return raw === null ? '' : splitFrontMatter(raw).body;
}

export interface ClarificationLabel {
  value: ClarityLabel;
  signals: ClaritySignal[];
  question_budget: number;
}

export interface ClarificationQuestions {
  asked: PipelineQuestion[];
  auto_answered: AutoAnswer[];
  deferred: PipelineQuestion[];
  counts: QuestionCounts;
}

export interface ClarificationBody {
  label: ClarificationLabel | null;
  questions: ClarificationQuestions | null;
}

export function readClarification(projectRoot: string, dirName: string): ClarificationBody | null {
  const body = readBundleBody(projectRoot, dirName, 'clarification');
  if (body === null) return null;
  return {
    label: isRecord(body.label) ? (body.label as unknown as ClarificationLabel) : null,
    questions: isRecord(body.questions)
      ? (body.questions as unknown as ClarificationQuestions)
      : null,
  };
}

function writeClarification(
  projectRoot: string,
  dirName: string,
  patch: Partial<ClarificationBody>,
  options: StoreWriteOptions,
): void {
  const current = readClarification(projectRoot, dirName) ?? { label: null, questions: null };
  writeBundleBody(
    projectRoot,
    dirName,
    'clarification',
    CLARIFICATION_DOC_TYPE,
    { ...current, ...patch },
    options,
  );
}

export function writeLabel(
  projectRoot: string,
  dirName: string,
  label: LabelArtifact,
  options: StoreWriteOptions = {},
): void {
  writeClarification(
    projectRoot,
    dirName,
    {
      label: {
        value: label.label,
        signals: label.signals,
        question_budget: label.question_budget,
      },
    },
    options,
  );
}

export function readLabel(projectRoot: string, dirName: string): LabelArtifact | null {
  const section = readClarification(projectRoot, dirName)?.label;
  if (!section) return null;
  return {
    label: section.value,
    signals: section.signals,
    question_budget: section.question_budget,
  };
}

export function writeQuestions(
  projectRoot: string,
  dirName: string,
  questions: QuestionsArtifact,
  options: StoreWriteOptions = {},
): void {
  writeClarification(
    projectRoot,
    dirName,
    {
      questions: {
        asked: questions.questions,
        auto_answered: questions.auto_answered,
        deferred: questions.deferred_from_experts ?? [],
        counts: {
          asked: questions.asked,
          answered: questions.answered,
          auto_answered: questions.auto_answered.length,
          deferred: questions.deferred,
        },
      },
    },
    options,
  );
}

export function readQuestions(projectRoot: string, dirName: string): QuestionsArtifact | null {
  const section = readClarification(projectRoot, dirName)?.questions;
  if (!section) return null;
  return {
    questions: section.asked,
    auto_answered: section.auto_answered,
    asked: section.counts.asked,
    answered: section.counts.answered,
    deferred: section.counts.deferred,
    ...(section.deferred.length > 0 ? { deferred_from_experts: section.deferred } : {}),
  };
}

export function clearClarificationSection(
  projectRoot: string,
  dirName: string,
  section: keyof ClarificationBody,
  options: StoreWriteOptions = {},
): void {
  writeClarification(projectRoot, dirName, { [section]: null }, options);
}

export interface ExpertRosterEntry {
  role: AgentRole;
  reason: string;
  lens: string;
  budget_tokens: number;
  grounding_truncated: boolean;
  brief_hash: string;
  tokens_used: number | null;
  origin?: ExpertOrigin;
}

export interface RecordedExpertFinding extends ExpertFinding {
  id: string;
  role: AgentRole;
}

export interface ExpertsBody {
  roster: ExpertRosterEntry[];
  findings: RecordedExpertFinding[] | null;
  synthesis: ExpertSynthesis | null;
  voice_warnings?: VoiceWarning[];
}

export function readExperts(projectRoot: string, dirName: string): ExpertsBody | null {
  const body = readBundleBody(projectRoot, dirName, 'experts');
  if (body === null || !Array.isArray(body.roster)) return null;
  return {
    roster: body.roster as ExpertRosterEntry[],
    findings: Array.isArray(body.findings) ? (body.findings as RecordedExpertFinding[]) : null,
    synthesis: isRecord(body.synthesis) ? (body.synthesis as unknown as ExpertSynthesis) : null,
    ...(Array.isArray(body.voice_warnings)
      ? { voice_warnings: body.voice_warnings as VoiceWarning[] }
      : {}),
  };
}

function writeExperts(
  projectRoot: string,
  dirName: string,
  patch: Partial<ExpertsBody>,
  options: StoreWriteOptions,
): void {
  const current = readExperts(projectRoot, dirName) ?? {
    roster: [],
    findings: null,
    synthesis: null,
  };
  writeBundleBody(
    projectRoot,
    dirName,
    'experts',
    EXPERTS_DOC_TYPE,
    { ...current, ...patch },
    options,
  );
}

export function writeExpertRoster(
  projectRoot: string,
  dirName: string,
  roster: ExpertRosterEntry[],
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { roster }, options);
}

export function readExpertNeed(projectRoot: string, dirName: string): ExpertNeedArtifact | null {
  const experts = readExperts(projectRoot, dirName);
  if (experts === null) return null;
  return {
    experts: experts.roster.map(({ role, reason, origin }) => ({
      role,
      reason,
      ...(origin === undefined ? {} : { origin }),
    })),
  };
}

interface StagedExpertQuestions {
  notes: { role: AgentRole; questions: PipelineQuestion[] }[];
}

export function expertNotesLockDir(projectRoot: string, dirName: string): string {
  return join(projectRoot, PATHS.LOCKS_DIR, `experts-${featureChangeKey(dirName)}.lock`);
}

function warningBelongsTo(warning: VoiceWarning, role: AgentRole): boolean {
  const prefix = `EX-${role}-`;
  return warning.id.startsWith(prefix) && /^\d+$/.test(warning.id.slice(prefix.length));
}

function inRosterOrder(
  findings: RecordedExpertFinding[],
  roster: ExpertRosterEntry[],
): RecordedExpertFinding[] {
  const seat = new Map(roster.map((entry, index) => [entry.role, index]));
  const rank = (role: AgentRole): number => seat.get(role) ?? roster.length;
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => rank(a.finding.role) - rank(b.finding.role) || a.index - b.index)
    .map(({ finding }) => finding);
}

export function writeExpertNotes(
  projectRoot: string,
  dirName: string,
  artifact: ExpertNotesArtifact,
  options: StoreWriteOptions = {},
): void {
  withFileLockSync(expertNotesLockDir(projectRoot, dirName), () =>
    mergeExpertNotesLocked(projectRoot, dirName, artifact, options),
  );
}

function mergeExpertNotesLocked(
  projectRoot: string,
  dirName: string,
  artifact: ExpertNotesArtifact,
  options: StoreWriteOptions,
): void {
  const current = readExperts(projectRoot, dirName);
  const noteRoles = new Set(artifact.notes.map((note) => note.role));
  const tokenRoles = new Set(Object.keys(artifact.tokens) as AgentRole[]);
  const roles = new Set<AgentRole>([...noteRoles, ...tokenRoles]);

  const kept = (current?.findings ?? []).filter((finding) => !roles.has(finding.role));
  const incoming: RecordedExpertFinding[] = artifact.notes.flatMap((note) =>
    note.findings.map(({ id, ...finding }) => ({ id: id!, role: note.role, ...finding })),
  );
  const roster = (current?.roster ?? []).map((entry) =>
    roles.has(entry.role) ? { ...entry, tokens_used: artifact.tokens[entry.role] ?? null } : entry,
  );
  const touched = [...roles];
  const keptWarnings = (current?.voice_warnings ?? []).filter(
    (warning) => !touched.some((role) => warningBelongsTo(warning, role)),
  );
  const voiceWarnings =
    artifact.voice_warnings === undefined && current?.voice_warnings === undefined
      ? undefined
      : [...keptWarnings, ...(artifact.voice_warnings ?? [])];
  writeExperts(
    projectRoot,
    dirName,
    {
      roster,
      findings: inRosterOrder([...kept, ...incoming], roster),
      ...(voiceWarnings === undefined ? {} : { voice_warnings: voiceWarnings }),
    },
    options,
  );

  const questions = [
    ...readStagedExpertQuestions(projectRoot, dirName).filter((note) => !roles.has(note.role)),
    ...artifact.notes
      .filter((note) => (note.questions ?? []).length > 0)
      .map((note) => ({ role: note.role, questions: note.questions! })),
  ];
  if (questions.length > 0) {
    writeStagedJson(projectRoot, dirName, 'expertQuestions', { notes: questions });
  } else {
    clearStaged(projectRoot, dirName, 'expertQuestions');
  }
}

export function readStagedExpertQuestions(
  projectRoot: string,
  dirName: string,
): StagedExpertQuestions['notes'] {
  return (
    readStagedJson<StagedExpertQuestions>(projectRoot, dirName, 'expertQuestions')?.notes ?? []
  );
}

export function readExpertNotes(projectRoot: string, dirName: string): ExpertNotesArtifact | null {
  const experts = readExperts(projectRoot, dirName);
  if (experts === null || experts.findings === null) return null;
  const byRole = new Map<AgentRole, ExpertNote>();
  const noteFor = (role: AgentRole): ExpertNote => {
    const existing = byRole.get(role);
    if (existing) return existing;
    const created: ExpertNote = { role, findings: [] };
    byRole.set(role, created);
    return created;
  };
  for (const { role, ...finding } of experts.findings) noteFor(role).findings.push(finding);
  for (const { role, questions } of readStagedExpertQuestions(projectRoot, dirName)) {
    noteFor(role).questions = questions;
  }
  const tokens: Partial<Record<AgentRole, number>> = {};
  for (const entry of experts.roster) {
    if (entry.tokens_used !== null) tokens[entry.role] = entry.tokens_used;
  }
  return { notes: [...byRole.values()], tokens };
}

export function writeExpertSynthesis(
  projectRoot: string,
  dirName: string,
  synthesis: ExpertSynthesis,
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { synthesis }, options);
}

export function writeExpertFindings(
  projectRoot: string,
  dirName: string,
  findings: RecordedExpertFinding[],
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { findings }, options);
}

export function readExpertSynthesis(projectRoot: string, dirName: string): ExpertSynthesis | null {
  return readExperts(projectRoot, dirName)?.synthesis ?? null;
}

export function clearExpertSynthesis(
  projectRoot: string,
  dirName: string,
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { synthesis: null }, options);
}

export function readGrounding(projectRoot: string, dirName: string): GroundingArtifact | null {
  const staged = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  if (staged) return staged;
  const frozen = readBundleBody(projectRoot, dirName, 'specification')?.grounding;
  if (!isRecord(frozen) || !Array.isArray(frozen.references)) return null;
  return { terms: [], ...(frozen as unknown as Omit<GroundingArtifact, 'terms'>) };
}

export function readFrozenSpecificationBody(
  projectRoot: string,
  dirName: string,
): Record<string, unknown> | null {
  return readBundleBody(projectRoot, dirName, 'specification');
}

export interface FreezeSections {
  task?: SpecTaskSection;
  grounding?: SpecGroundingSection;
  pipeline: SpecPipelineSection;
  trace?: SpecTraceMap;
}

export function readFreezeSections(projectRoot: string, dirName: string): FreezeSections | null {
  const finish = readStagedJson<StagedFinish>(projectRoot, dirName, 'finish');
  if (!isRecord(finish) || !isRecord(finish.provenance)) return null;
  const task = readStagedJson<Record<string, unknown>>(projectRoot, dirName, 'task');
  const grounding = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  const trace = readStagedJson<{ entries?: unknown }>(projectRoot, dirName, 'trace');
  return {
    ...(isRecord(task) && typeof task.intent === 'string'
      ? { task: { intent: task.intent, scope: isRecord(task.scope) ? task.scope : {} } }
      : {}),
    ...(isRecord(grounding)
      ? {
          grounding: {
            path: grounding.path,
            sparse: grounding.sparse,
            references: grounding.references,
            ...(Array.isArray(grounding.vocabulary) ? { vocabulary: grounding.vocabulary } : {}),
          },
        }
      : {}),
    pipeline: withExpertFreezeSummary(frozenPipelineSection(finish), projectRoot, dirName),
    ...(isRecord(trace) && Array.isArray(trace.entries)
      ? {
          trace: Object.fromEntries(
            (trace.entries as { id: string; source: string }[]).map((entry) => [
              entry.id,
              entry.source,
            ]),
          ),
        }
      : {}),
  };
}

function withExpertFreezeSummary(
  pipeline: SpecPipelineSection,
  projectRoot: string,
  dirName: string,
): SpecPipelineSection {
  const experts = readExperts(projectRoot, dirName);
  if (!experts || !experts.synthesis) return pipeline;
  const syn = experts.synthesis;
  const acceptedIds = new Set(syn.accepted);
  const findings = (experts.findings ?? [])
    .filter((finding) => acceptedIds.has(finding.id))
    .map((finding) => ({
      id: finding.id,
      role: finding.role,
      kind: finding.kind ?? 'requirement',
      severity: finding.severity ?? 'should',
      target: finding.target,
      claim: finding.claim,
    }));
  const renamed = (experts.findings ?? []).filter(
    (finding) => finding.renamed_from !== undefined,
  ).length;
  return {
    ...pipeline,
    experts: {
      roles: experts.roster.map((entry) => entry.role),
      accepted: syn.accepted.length,
      declined: syn.declined.length,
      conflicts: syn.conflicts.length,
      auto_resolved: syn.auto_resolved?.length ?? 0,
      standing: experts.roster.filter((entry) => entry.origin === 'standing').length,
      on_call: experts.roster
        .filter((entry) => entry.origin !== 'standing')
        .map((entry) => entry.role),
      renamed,
    },
    ...(findings.length > 0 ? { findings } : {}),
  };
}

function isTmpPath(rel: string): boolean {
  return rel.startsWith('.paqad/tmp/') && !rel.split('/').includes('..');
}

export function clearFrozenRun(
  projectRoot: string,
  dirName: string,
  keep: readonly string[] = [],
): void {
  for (const rel of readRememberedInputs(projectRoot, dirName)) {
    if (isTmpPath(rel) && !keep.includes(rel)) rmSync(join(projectRoot, rel), { force: true });
  }
  rmSync(join(projectRoot, stagingDir(dirName)), { recursive: true, force: true });
  try {
    rmdirSync(join(projectRoot, SPEC_PIPELINE_STAGING_DIR));
  } catch {}
}

function rootForms(projectRoot: string): string[] {
  const given = resolve(projectRoot);
  let real = given;
  try {
    real = resolve(realpathSync(projectRoot));
  } catch {}
  return [...new Set([given, real])];
}

function tmpInputPath(projectRoot: string, file: string): string | null {
  const abs = resolve(file);
  for (const base of rootForms(projectRoot)) {
    const rel = relative(base, abs);
    if (rel.startsWith('.paqad/tmp/')) return rel;
  }
  return null;
}

export function rememberInput(projectRoot: string, dirName: string, file: string): void {
  const rel = tmpInputPath(projectRoot, file);
  if (rel === null) return;
  const inputs = readRememberedInputs(projectRoot, dirName);
  if (inputs.includes(rel)) return;
  writeStagedJson(projectRoot, dirName, 'inputs', { inputs: [...inputs, rel] });
}

export function readRememberedInputs(projectRoot: string, dirName: string): string[] {
  return readStagedJson<{ inputs: string[] }>(projectRoot, dirName, 'inputs')?.inputs ?? [];
}

export interface SpecStepRowInput {
  step: PipelineStep;
  outcome: SpecStepOutcome;
  artifactHash: string;
  tokens?: number;
}

export function appendSpecStepRow(
  projectRoot: string,
  dirName: string,
  input: SpecStepRowInput,
  options: StoreWriteOptions = {},
): SessionLedgerRow {
  return appendFeatureStageRow(
    projectRoot,
    documentSessionId(projectRoot, dirName, options.sessionId),
    dirName,
    {
      kind: SPEC_STEP_KIND,
      step: input.step,
      outcome: input.outcome,
      artifact_hash: input.artifactHash,
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    },
    options.now,
  );
}

export function readSpecStepRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter((row) => row.kind === SPEC_STEP_KIND);
}

export function appendSpecCorrectionRow(
  projectRoot: string,
  dirName: string,
  correction: { spec_id: string; changed_sections: string[] },
  options: StoreWriteOptions = {},
): SessionLedgerRow {
  return appendFeatureStageRow(
    projectRoot,
    documentSessionId(projectRoot, dirName, options.sessionId),
    dirName,
    {
      kind: SPEC_CORRECTION_KIND,
      spec_id: correction.spec_id,
      changed_sections: correction.changed_sections,
    },
    options.now,
  );
}

export function readSpecCorrectionRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter(
    (row) => row.kind === SPEC_CORRECTION_KIND,
  );
}
