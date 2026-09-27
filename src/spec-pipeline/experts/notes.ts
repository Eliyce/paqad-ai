// Validate the expert NOTES artifact (issue #521, FR-6/FR-7).
//
// After the roster decision (need.ts) the experts run and hand back structured notes plus their
// token actuals. This module validates that returned artifact against the roster (an expert that
// was never in the need set cannot smuggle notes in). Storing it is the run store's job
// (`experts.json` findings and roster tokens, issue #581). Deterministic; zero model tokens.

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

/** The notes each expert returned, plus the tokens they actually spent. */
export interface ExpertNotesArtifact {
  notes: ExpertNote[];
  tokens: Partial<Record<AgentRole, number>>;
  /** Targets the project does not name (issue #558, FR-5.2). Never a refusal; shown to the chief. */
  voice_warnings?: VoiceWarning[];
}

/** What the voice check reads to judge a finding's target (issue #558, FR-5.1). */
export interface FindingVoiceSources {
  /** The project vocabulary from grounding. */
  vocabulary: VocabularyEntry[];
  /** The request text. */
  requestText: string;
  /** The project root, for the path-exists rule. */
  projectRoot: string;
  /** Whether a code-knowledge index exists (the symbol rule is skipped when it does not). */
  indexPresent: boolean;
}

/** The outcome of the voice check for one finding (issue #558, FR-5.1). */
export interface VoiceCheckResult {
  ok: boolean;
  /** The one-line hint, present only when `ok` is false. */
  hint?: string;
}

function normalizeTarget(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The vocabulary entry closest to a target by simple substring match, or null. */
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

/**
 * The deterministic voice check for one finding's target (issue #558, FR-5.1 / Section 5.4). A
 * target is allowed when it is a word the project already uses (a vocabulary term or a word from
 * the request), an existing path or an indexed symbol, or a `new `-prefixed / `this request`
 * target. Anything else records a warning with a hint naming the closest business and technical
 * word. Never a refusal (INV-5). Deterministic; zero model tokens.
 */
export function checkFindingVoice(
  finding: ExpertFinding,
  sources: FindingVoiceSources,
): VoiceCheckResult {
  const target = normalizeTarget(finding.target);
  // Rule 3: a new thing, or the whole request.
  if (target.startsWith('new ') || target === 'this request') return { ok: true };

  // Rule 1: the target is a word the project uses (a vocabulary term or a word from the request).
  const inVocabulary = sources.vocabulary.some((entry) => normalizeTarget(entry.term) === target);
  if (inVocabulary) return { ok: true };
  if (normalizeTarget(sources.requestText).includes(target)) return { ok: true };

  // Rule 2: the target names an existing path, or a symbol the code-knowledge index resolves.
  const stripped = finding.target.replace(/`/g, '').trim();
  if (stripped.length > 0 && existsSync(join(sources.projectRoot, stripped))) return { ok: true };
  if (sources.indexPresent) {
    const index = readCodeKnowledgeIndex(sources.projectRoot);
    if (index && queryCodeKnowledge(index, stripped).matches.length > 0) return { ok: true };
  }

  // Rule 4: a warning, never a refusal. Name the closest business and technical word.
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

/**
 * Validate a raw notes artifact (issue #521, extended by #547 FR-4.4). `notes[]` is required; each
 * note names a roster role and a `findings[]` of `{ target, claim }` non-empty strings. A finding
 * MAY carry a `kind` (defaulted to `requirement`), a `severity` (defaulted to `should`) and an
 * optional `evidence` string; an unknown kind or severity is rejected. A note MAY carry
 * `questions[]`, each a `PipelineQuestion`; when {@link sources} is supplied every question is run
 * through the plain-language check and a failing one is rejected with its flagged terms. Every
 * finding is assigned a stable `EX-<role>-<n>` id in note order (FR-4.4). `tokens` is optional and
 * maps roster roles to non-negative numbers. Rejects a role outside the roster in both `notes` and
 * `tokens` — the guard extends to notes, not just the need decision.
 */
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

  // Voice check (issue #558, FR-5.2): after every finding has its stable id, flag any target the
  // project does not name. Never a refusal — the warnings are recorded and shown to the chief.
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

/** The outcome of validating one raw question object. */
export interface QuestionValidation {
  ok: boolean;
  error?: string;
  question?: PipelineQuestion;
}

/**
 * Validate one raw object as a {@link PipelineQuestion} (issue #547, FR-4.4 / FR-5.4). Requires
 * non-empty `business_text`, `why_it_matters`, a non-empty `options[]` of strings, and a
 * `grounded_in` that is a string or null. When {@link sources} is supplied the plain-language
 * check runs and a question written in model jargon is refused, naming the flagged terms.
 */
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
