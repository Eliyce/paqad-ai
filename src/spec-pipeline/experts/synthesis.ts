// The chief architect's synthesis (issue #547, FR-5).
//
// After the experts write notes and the script merges them, ONE more model call — the chief
// architect (`expert-synthesis` skill) — reads the request, the grounding, every note and the
// merge, and returns a verdict: which findings it accepts, which it declines and why, a
// recommendation for each conflict, the gaps nobody covered, and the questions worth asking. This
// module is the deterministic guard around THAT decision. The chief may accept, decline or flag a
// gap; it may NOT invent a finding (INV-7). Deterministic; zero model tokens.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { pipelineArtifactPath, PIPELINE_ARTIFACT_FILES } from '../orchestrator.js';
import type { PlainLanguageSources } from '../plain-language.js';
import type { PipelineQuestion } from '../types.js';
import { validateQuestion } from './notes.js';
import type { MergedExpertNotes } from './types.js';

/** The chief architect's overall read of readiness. */
export type SynthesisVerdict = 'ready' | 'needs-answers' | 'not-ready';

const VERDICTS: readonly SynthesisVerdict[] = ['ready', 'needs-answers', 'not-ready'];

/** A finding the chief declined, with its reason. */
export interface SynthesisDeclined {
  id: string;
  reason: string;
}

/** The chief's recommended resolution for one conflict (a recommendation, never applied). */
export interface SynthesisConflict {
  target: string;
  /** One of the conflicting claims, verbatim — the chief recommends, the human decides. */
  recommendation: string;
  rationale: string;
}

/** An area no expert covered. */
export interface SynthesisGap {
  area: string;
  why_it_matters: string;
  question?: PipelineQuestion;
}

/** A conflict auto-resolved from an identical prior decision (issue #547, FR-6.3). */
export interface SynthesisAutoResolved {
  target: string;
  chosen: string;
  source: string;
}

/** The validated chief-architect synthesis artifact (`expert-synthesis.json`). */
export interface ExpertSynthesis {
  verdict: SynthesisVerdict;
  accepted: string[];
  declined: SynthesisDeclined[];
  conflicts: SynthesisConflict[];
  gaps: SynthesisGap[];
  questions: PipelineQuestion[];
  tokens: number;
  /** Conflicts the framework answered from a resolved fork before minting a packet (FR-6.3). */
  auto_resolved?: SynthesisAutoResolved[];
}

export interface ExpertSynthesisValidation {
  ok: boolean;
  error?: string;
  artifact?: ExpertSynthesis;
}

function fail(error: string): ExpertSynthesisValidation {
  return { ok: false, error };
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Validate a raw chief-architect synthesis against the merge it read (FR-5.4). Refuses:
 *   - a bad verdict;
 *   - an `accepted`/`declined` that does not cover every merged finding id EXACTLY once;
 *   - an id the merge does not know (the chief may not add a finding, INV-7);
 *   - a declined entry with an empty reason;
 *   - a conflict set that is not exactly one row per merge conflict, or a recommendation that is
 *     not one of that conflict's claims;
 *   - a question (in `questions` or a gap) that fails the plain-language check when {@link sources}
 *     is supplied.
 */
export function validateExpertSynthesis(
  raw: unknown,
  merged: MergedExpertNotes,
  sources?: PlainLanguageSources,
): ExpertSynthesisValidation {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (parsed === undefined) return fail('expert-synthesis artifact is not valid JSON');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('expert-synthesis artifact must be an object');
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.verdict !== 'string' || !VERDICTS.includes(obj.verdict as SynthesisVerdict)) {
    return fail(`synthesis verdict must be one of ${VERDICTS.join(' | ')}`);
  }
  if (!Array.isArray(obj.accepted) || !obj.accepted.every((id) => typeof id === 'string')) {
    return fail('synthesis needs an accepted[] of finding ids');
  }
  if (!Array.isArray(obj.declined)) {
    return fail('synthesis needs a declined[] array');
  }

  const knownIds = new Set(merged.findings.map((finding) => finding.id ?? ''));
  const seen = new Set<string>();
  const accepted: string[] = [];
  for (const id of obj.accepted as string[]) {
    if (!knownIds.has(id)) {
      return fail('the chief architect may accept, decline or flag a gap; it may not add findings');
    }
    if (seen.has(id)) return fail(`finding ${id} appears twice in accept/decline`);
    seen.add(id);
    accepted.push(id);
  }

  const declined: SynthesisDeclined[] = [];
  for (const [index, entry] of (obj.declined as unknown[]).entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail(`declined[${index}] must be an object with id and reason`);
    }
    const { id, reason } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !knownIds.has(id)) {
      return fail('the chief architect may accept, decline or flag a gap; it may not add findings');
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return fail(`declined[${index}] ("${id}") needs a non-empty reason`);
    }
    if (seen.has(id)) return fail(`finding ${id} appears twice in accept/decline`);
    seen.add(id);
    declined.push({ id, reason: reason.trim() });
  }

  for (const id of knownIds) {
    if (!seen.has(id)) {
      return fail(`finding ${id} is neither accepted nor declined — every merged finding must be`);
    }
  }

  const conflictResult = validateConflicts(obj.conflicts, merged);
  if (!conflictResult.ok) return fail(conflictResult.error!);

  const gapResult = validateGaps(obj.gaps, sources);
  if (!gapResult.ok) return fail(gapResult.error!);

  const questions: PipelineQuestion[] = [];
  if (obj.questions !== undefined) {
    if (!Array.isArray(obj.questions)) return fail('synthesis questions must be an array');
    for (const [qi, question] of obj.questions.entries()) {
      const validated = validateQuestion(question, `synthesis.questions[${qi}]`, sources);
      if (!validated.ok) return fail(validated.error!);
      questions.push(validated.question!);
    }
  }

  const tokens = typeof obj.tokens === 'number' && obj.tokens >= 0 ? obj.tokens : 0;

  return {
    ok: true,
    artifact: {
      verdict: obj.verdict as SynthesisVerdict,
      accepted,
      declined,
      conflicts: conflictResult.conflicts,
      gaps: gapResult.gaps,
      questions,
      tokens,
    },
  };
}

interface ConflictResult {
  ok: boolean;
  error?: string;
  conflicts: SynthesisConflict[];
}

function validateConflicts(raw: unknown, merged: MergedExpertNotes): ConflictResult {
  const conflicts: SynthesisConflict[] = [];
  if (raw === undefined) {
    return merged.conflicts.length === 0
      ? { ok: true, conflicts }
      : { ok: false, error: 'synthesis must resolve every merge conflict exactly once', conflicts };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'synthesis conflicts must be an array', conflicts };
  }
  if (raw.length !== merged.conflicts.length) {
    return {
      ok: false,
      error: `synthesis has ${raw.length} conflict rows but the merge found ${merged.conflicts.length}; resolve each exactly once`,
      conflicts,
    };
  }
  const claimsByTarget = new Map(
    merged.conflicts.map((conflict) => [
      normalize(conflict.target),
      conflict.claims.map(normalize),
    ]),
  );
  const seenTargets = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `conflicts[${index}] must be an object`, conflicts };
    }
    const { target, recommendation, rationale } = entry as Record<string, unknown>;
    if (typeof target !== 'string' || !claimsByTarget.has(normalize(target))) {
      return {
        ok: false,
        error: `conflicts[${index}] target "${String(target)}" is not a merge conflict`,
        conflicts,
      };
    }
    const key = normalize(target);
    if (seenTargets.has(key)) {
      return { ok: false, error: `conflicts names "${target}" twice`, conflicts };
    }
    seenTargets.add(key);
    if (
      typeof recommendation !== 'string' ||
      !claimsByTarget.get(key)!.includes(normalize(recommendation))
    ) {
      return {
        ok: false,
        error: `conflicts[${index}] recommendation must be one of the conflicting claims verbatim`,
        conflicts,
      };
    }
    if (typeof rationale !== 'string' || rationale.trim().length === 0) {
      return { ok: false, error: `conflicts[${index}] needs a non-empty rationale`, conflicts };
    }
    conflicts.push({ target, recommendation, rationale: rationale.trim() });
  }
  return { ok: true, conflicts };
}

interface GapResult {
  ok: boolean;
  error?: string;
  gaps: SynthesisGap[];
}

function validateGaps(raw: unknown, sources?: PlainLanguageSources): GapResult {
  const gaps: SynthesisGap[] = [];
  if (raw === undefined) return { ok: true, gaps };
  if (!Array.isArray(raw)) return { ok: false, error: 'synthesis gaps must be an array', gaps };
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `gaps[${index}] must be an object`, gaps };
    }
    const { area, why_it_matters, question } = entry as Record<string, unknown>;
    if (typeof area !== 'string' || area.trim().length === 0) {
      return { ok: false, error: `gaps[${index}] needs a non-empty area`, gaps };
    }
    if (typeof why_it_matters !== 'string' || why_it_matters.trim().length === 0) {
      return { ok: false, error: `gaps[${index}] needs a non-empty why_it_matters`, gaps };
    }
    const gap: SynthesisGap = { area, why_it_matters };
    if (question !== undefined) {
      const validated = validateQuestion(question, `gaps[${index}].question`, sources);
      if (!validated.ok) return { ok: false, error: validated.error, gaps };
      gap.question = validated.question;
    }
    gaps.push(gap);
  }
  return { ok: true, gaps };
}

/** Path to the synthesis scratch artifact (the `experts` step artifact). */
export function expertSynthesisPath(dirName: string): string {
  return pipelineArtifactPath(dirName, 'experts');
}

/** Path to the merge scratch artifact the synthesis reads (FR-5.1). */
export function expertMergePath(dirName: string): string {
  return join(dirname(pipelineArtifactPath(dirName, 'experts')), 'expert-merge.json');
}

function writeJson(abs: string, value: unknown): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Write the merge artifact to scratch (FR-5.1). */
export function writeExpertMerge(
  projectRoot: string,
  dirName: string,
  value: MergedExpertNotes,
): void {
  writeJson(join(projectRoot, expertMergePath(dirName)), value);
}

/** Read the merge artifact, or null when the experts step never merged. */
export function readExpertMerge(projectRoot: string, dirName: string): MergedExpertNotes | null {
  return readJson(join(projectRoot, expertMergePath(dirName))) as MergedExpertNotes | null;
}

/** Write the validated synthesis to the `experts` step artifact. */
export function writeExpertSynthesis(
  projectRoot: string,
  dirName: string,
  value: ExpertSynthesis,
): void {
  writeJson(join(projectRoot, expertSynthesisPath(dirName)), value);
}

/** Read the stored synthesis, or null when the chief never ran. */
export function readExpertSynthesis(projectRoot: string, dirName: string): ExpertSynthesis | null {
  return readJson(join(projectRoot, expertSynthesisPath(dirName))) as ExpertSynthesis | null;
}

/** A light shape check for the step-lock — the full validation runs in the CLI verb. */
export function isSynthesisShaped(raw: string | null): boolean {
  if (raw === null) return false;
  const data = parseJson(raw);
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.verdict === 'string' &&
    Array.isArray(obj.accepted) &&
    Array.isArray(obj.declined) &&
    Array.isArray(obj.conflicts) &&
    Array.isArray(obj.gaps)
  );
}

// The synthesis artifact filename, exported so the orchestrator's step-artifact map stays in sync.
export const EXPERT_SYNTHESIS_FILE = PIPELINE_ARTIFACT_FILES.experts;

function readJson(abs: string): unknown | null {
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
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
