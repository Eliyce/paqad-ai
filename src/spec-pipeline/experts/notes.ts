import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';
import { queryCodeKnowledge } from '@/code-knowledge/query.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';

import { checkPlainLanguage, type PlainLanguageSources } from '../plain-language.js';
import type { PipelineQuestion, VocabularyEntry } from '../types.js';
import { isExpertRole } from './roster.js';
import type {
  ExpertFinding,
  ExpertNote,
  FindingKind,
  FindingSeverity,
  VoiceWarning,
} from './types.js';

const FINDING_KINDS: readonly FindingKind[] = [
  'requirement',
  'invariant',
  'acceptance',
  'risk',
  'non-goal',
];
const FINDING_SEVERITIES: readonly FindingSeverity[] = ['must', 'should', 'could'];

export interface ExpertNotesArtifact {
  notes: ExpertNote[];
  tokens: Partial<Record<AgentRole, number>>;
  voice_warnings?: VoiceWarning[];
}

export interface FindingVoiceSources {
  vocabulary: VocabularyEntry[];
  requestText: string;
  projectRoot: string;
  indexPresent: boolean;
}

export interface VoiceCheckResult {
  ok: boolean;
  hint?: string;
}

function normalizeTarget(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function closestWord(target: string, entries: VocabularyEntry[]): VocabularyEntry | null {
  for (const entry of entries) {
    const term = normalizeTarget(entry.term);
    if (term.length < 3) continue;
    if (target.includes(term) || term.includes(target)) return entry;
  }
  for (const entry of entries) {
    const shared = normalizeTarget(entry.term)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);
    if (shared.some((token) => target.includes(token))) return entry;
  }
  return null;
}

export function checkFindingVoice(
  finding: ExpertFinding,
  sources: FindingVoiceSources,
): VoiceCheckResult {
  const target = normalizeTarget(finding.target);
  if (target.startsWith('new ') || target === 'this request') return { ok: true };

  const inVocabulary = sources.vocabulary.some((entry) => normalizeTarget(entry.term) === target);
  if (inVocabulary) return { ok: true };
  if (normalizeTarget(sources.requestText).includes(target)) return { ok: true };

  const stripped = finding.target.replace(/`/g, '').trim();
  if (stripped.length > 0 && existsSync(join(sources.projectRoot, stripped))) return { ok: true };
  if (sources.indexPresent) {
    const index = readCodeKnowledgeIndex(sources.projectRoot);
    if (index && queryCodeKnowledge(index, stripped).matches.length > 0) return { ok: true };
  }

  const business = closestWord(
    target,
    sources.vocabulary.filter((entry) => entry.kind !== 'technical'),
  );
  const technical = closestWord(
    target,
    sources.vocabulary.filter((entry) => entry.kind === 'technical'),
  );
  const parts: string[] = [];
  if (business) parts.push(`the docs say "${business.term}" (${business.kind})`);
  if (technical) parts.push(`the schema page names "${technical.term}"`);
  const closeness = parts.length > 0 ? parts.join(' and ') : 'no close match';
  return {
    ok: false,
    hint: `target "${finding.target}" is not a name this project uses; ${closeness}`,
  };
}

export interface ExpertNotesValidation {
  ok: boolean;
  error?: string;
  artifact?: ExpertNotesArtifact;
}

function fail(error: string): ExpertNotesValidation {
  return { ok: false, error };
}

export function validateExpertNotes(
  raw: unknown,
  sources?: PlainLanguageSources,
  voiceSources?: FindingVoiceSources,
): ExpertNotesValidation {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (parsed === undefined) return fail('expert-notes artifact is not valid JSON');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('expert-notes artifact must be an object with a notes[] array');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.notes)) return fail('expert-notes artifact needs a notes[] array');

  const notes: ExpertNote[] = [];
  const idCounters = new Map<AgentRole, number>();
  for (const [index, entry] of obj.notes.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail(`notes[${index}] must be an object with role and findings`);
    }
    const { role, findings, questions } = entry as Record<string, unknown>;
    if (typeof role !== 'string' || !isExpertRole(role)) {
      return fail(`notes[${index}].role "${String(role)}" is not an expert in the roster`);
    }
    if (!Array.isArray(findings)) {
      return fail(`notes[${index}] ("${role}") needs a findings[] array`);
    }
    const parsedFindings: ExpertFinding[] = [];
    for (const [fi, finding] of findings.entries()) {
      if (typeof finding !== 'object' || finding === null || Array.isArray(finding)) {
        return fail(`notes[${index}].findings[${fi}] must be an object with target and claim`);
      }
      const { target, claim, kind, severity, evidence } = finding as Record<string, unknown>;
      if (typeof target !== 'string' || target.trim().length === 0) {
        return fail(`notes[${index}].findings[${fi}] needs a non-empty target`);
      }
      if (typeof claim !== 'string' || claim.trim().length === 0) {
        return fail(`notes[${index}].findings[${fi}] needs a non-empty claim`);
      }
      if (kind !== undefined && !FINDING_KINDS.includes(kind as FindingKind)) {
        return fail(
          `notes[${index}].findings[${fi}] has an unknown kind "${String(kind)}" (want ${FINDING_KINDS.join(' | ')})`,
        );
      }
      if (severity !== undefined && !FINDING_SEVERITIES.includes(severity as FindingSeverity)) {
        return fail(
          `notes[${index}].findings[${fi}] has an unknown severity "${String(severity)}" (want ${FINDING_SEVERITIES.join(' | ')})`,
        );
      }
      if (evidence !== undefined && typeof evidence !== 'string') {
        return fail(`notes[${index}].findings[${fi}] evidence must be a string when present`);
      }
      const seq = (idCounters.get(role) ?? 0) + 1;
      idCounters.set(role, seq);
      parsedFindings.push({
        id: `EX-${role}-${seq}`,
        target,
        claim,
        kind: (kind as FindingKind | undefined) ?? 'requirement',
        severity: (severity as FindingSeverity | undefined) ?? 'should',
        ...(typeof evidence === 'string' ? { evidence } : {}),
      });
    }

    const parsedQuestions: PipelineQuestion[] = [];
    if (questions !== undefined) {
      if (!Array.isArray(questions)) {
        return fail(`notes[${index}] ("${role}") questions must be an array when present`);
      }
      for (const [qi, question] of questions.entries()) {
        const validated = validateQuestion(question, `notes[${index}].questions[${qi}]`, sources);
        if (!validated.ok) return fail(validated.error!);
        parsedQuestions.push(validated.question!);
      }
    }

    notes.push({
      role,
      findings: parsedFindings,
      ...(parsedQuestions.length > 0 ? { questions: parsedQuestions } : {}),
    });
  }

  const tokens: Partial<Record<AgentRole, number>> = {};
  if (obj.tokens !== undefined) {
    if (typeof obj.tokens !== 'object' || obj.tokens === null || Array.isArray(obj.tokens)) {
      return fail('expert-notes "tokens" must be an object of role -> number');
    }
    for (const [role, value] of Object.entries(obj.tokens as Record<string, unknown>)) {
      if (!isExpertRole(role)) return fail(`tokens names "${role}", which is not an expert role`);
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fail(`tokens["${role}"] must be a non-negative number`);
      }
      tokens[role] = value;
    }
  }

  let voice_warnings: VoiceWarning[] | undefined;
  if (voiceSources) {
    const warnings: VoiceWarning[] = [];
    for (const note of notes) {
      for (const finding of note.findings) {
        const result = checkFindingVoice(finding, voiceSources);
        if (!result.ok) {
          warnings.push({ id: finding.id!, target: finding.target, hint: result.hint! });
        }
      }
    }
    voice_warnings = warnings;
  }

  return {
    ok: true,
    artifact: { notes, tokens, ...(voice_warnings === undefined ? {} : { voice_warnings }) },
  };
}

export interface QuestionValidation {
  ok: boolean;
  error?: string;
  question?: PipelineQuestion;
}

export function validateQuestion(
  raw: unknown,
  path: string,
  sources?: PlainLanguageSources,
): QuestionValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${path} must be a question object` };
  }
  const q = raw as Record<string, unknown>;
  if (typeof q.business_text !== 'string' || q.business_text.trim().length === 0) {
    return { ok: false, error: `${path} needs a non-empty business_text` };
  }
  if (typeof q.why_it_matters !== 'string' || q.why_it_matters.trim().length === 0) {
    return { ok: false, error: `${path} needs a non-empty why_it_matters` };
  }
  if (
    !Array.isArray(q.options) ||
    q.options.length === 0 ||
    !q.options.every((o) => typeof o === 'string' && o.trim().length > 0)
  ) {
    return { ok: false, error: `${path} needs a non-empty options[] of strings` };
  }
  if (q.grounded_in !== null && typeof q.grounded_in !== 'string') {
    return { ok: false, error: `${path} grounded_in must be a string or null` };
  }
  const question: PipelineQuestion = {
    business_text: q.business_text,
    why_it_matters: q.why_it_matters,
    options: q.options as string[],
    grounded_in: (q.grounded_in as string | null) ?? null,
    ...(typeof q.technical_note === 'string' ? { technical_note: q.technical_note } : {}),
  };
  if (sources) {
    const plain = checkPlainLanguage(question, sources);
    if (!plain.ok) {
      return {
        ok: false,
        error: `${path} is not plain language — flagged: ${plain.flagged.join(', ')}`,
      };
    }
  }
  return { ok: true, question };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
