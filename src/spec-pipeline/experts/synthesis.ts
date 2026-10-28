import type { PlainLanguageSources } from '../plain-language.js';
import type { PipelineQuestion } from '../types.js';
import { validateQuestion } from './notes.js';
import type {
  ExpertConflict,
  ExpertFinding,
  FindingKind,
  FindingSeverity,
  MergedExpertNotes,
} from './types.js';

export type SynthesisVerdict = 'ready' | 'needs-answers' | 'not-ready';

const VERDICTS: readonly SynthesisVerdict[] = ['ready', 'needs-answers', 'not-ready'];

export interface SynthesisDeclined {
  id: string;
  reason: string;
}

export type SynthesisRuling = 'pick' | 'compatible';

const RULINGS: readonly SynthesisRuling[] = ['pick', 'compatible'];

export interface SynthesisConflict {
  target: string;
  ruling?: SynthesisRuling;
  recommendation?: string;
  merged_claim?: string;
  rationale: string;
  claims?: string[];
  finding_ids?: string[];
}

export interface SynthesisGap {
  area: string;
  why_it_matters: string;
  question?: PipelineQuestion;
}

export interface SynthesisAutoResolved {
  target: string;
  chosen: string;
  source: string;
}

export interface SynthesisRename {
  id: string;
  target: string;
}

export interface ExpertSynthesis {
  verdict: SynthesisVerdict;
  accepted: string[];
  declined: SynthesisDeclined[];
  conflicts: SynthesisConflict[];
  gaps: SynthesisGap[];
  questions: PipelineQuestion[];
  tokens: number;
  auto_resolved?: SynthesisAutoResolved[];
  renames?: SynthesisRename[];
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

  const renameResult = validateRenames(obj.renames, knownIds);
  if (!renameResult.ok) return fail(renameResult.error!);

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
      ...(renameResult.renames.length > 0 ? { renames: renameResult.renames } : {}),
    },
  };
}

interface RenameResult {
  ok: boolean;
  error?: string;
  renames: SynthesisRename[];
}

function validateRenames(raw: unknown, knownIds: ReadonlySet<string>): RenameResult {
  const renames: SynthesisRename[] = [];
  if (raw === undefined) return { ok: true, renames };
  if (!Array.isArray(raw))
    return { ok: false, error: 'synthesis renames must be an array', renames };
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return {
        ok: false,
        error: `renames[${index}] must be an object with id and target`,
        renames,
      };
    }
    const { id, target } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !knownIds.has(id)) {
      return {
        ok: false,
        error: `renames names "${String(id)}", which the merge does not know`,
        renames,
      };
    }
    if (typeof target !== 'string' || target.trim().length === 0) {
      return { ok: false, error: `renames[${index}] ("${id}") needs a non-empty target`, renames };
    }
    renames.push({ id, target: target.trim() });
  }
  return { ok: true, renames };
}

export function applyRenames(
  findings: readonly ExpertFinding[],
  renames: readonly SynthesisRename[] = [],
): ExpertFinding[] {
  if (renames.length === 0) return [...findings];
  const byId = new Map(renames.map((rename) => [rename.id, rename.target]));
  return findings.map((finding) => {
    const target = finding.id !== undefined ? byId.get(finding.id) : undefined;
    if (target === undefined || target === finding.target) return finding;
    return { ...finding, target, renamed_from: finding.target };
  });
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
  const conflictByTarget = new Map(
    merged.conflicts.map((conflict) => [normalize(conflict.target), conflict]),
  );
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
    const { target, ruling, recommendation, merged_claim, rationale } = entry as Record<
      string,
      unknown
    >;
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
    if (ruling !== undefined && !RULINGS.includes(ruling as SynthesisRuling)) {
      return {
        ok: false,
        error: `conflicts[${index}] ruling must be one of ${RULINGS.join(' | ')}`,
        conflicts,
      };
    }
    if (typeof rationale !== 'string' || rationale.trim().length === 0) {
      return { ok: false, error: `conflicts[${index}] needs a non-empty rationale`, conflicts };
    }
    if (ruling === 'compatible') {
      const conflict = conflictByTarget.get(key)!;
      if (typeof merged_claim !== 'string' || merged_claim.trim().length === 0) {
        return {
          ok: false,
          error: `conflicts[${index}] is ruled compatible and needs a non-empty merged_claim`,
          conflicts,
        };
      }
      if (hasMustSecurityFinding(conflict)) {
        return {
          ok: false,
          error: `conflicts[${index}] includes a must-level security-auditor finding; rule it pick so the owner decides`,
          conflicts,
        };
      }
      conflicts.push({
        target,
        ruling: 'compatible',
        merged_claim: merged_claim.trim(),
        rationale: rationale.trim(),
        claims: [...conflict.claims],
        finding_ids: [...conflict.finding_ids],
      });
      continue;
    }
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
    conflicts.push({ target, ruling: 'pick', recommendation, rationale: rationale.trim() });
  }
  return { ok: true, conflicts };
}

function hasMustSecurityFinding(conflict: ExpertConflict): boolean {
  return conflict.roles.some(
    (role, index) => role === 'security-auditor' && conflict.severities?.[index] === 'must',
  );
}

export function isCompatibleRuling(conflict: SynthesisConflict): boolean {
  return conflict.ruling === 'compatible';
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { must: 3, should: 2, could: 1 };

export interface CompatibleMergeResult<T extends ExpertFinding> {
  findings: T[];
  accepted: string[];
  merged: number;
}

export function applyCompatibleRulings<T extends ExpertFinding & { id: string }>(
  findings: readonly T[],
  conflicts: readonly SynthesisConflict[],
  accepted: readonly string[],
): CompatibleMergeResult<T> {
  let next = [...findings];
  const acceptedIds = [...accepted];
  let mergedCount = 0;
  for (const conflict of conflicts) {
    if (!isCompatibleRuling(conflict)) continue;
    const ids = (conflict.finding_ids ?? []).filter((id) => id.length > 0);
    const sources = ids
      .map((id) => next.find((finding) => finding.id === id))
      .filter((finding): finding is T => finding !== undefined);
    const first = sources[0];
    if (!first) continue;
    const severity = strongestSeverity(sources);
    const kind = mergedKind(sources);
    const mergedFinding: T = {
      ...first,
      claim: conflict.merged_claim!,
      merged_from: ids,
      ...(severity ? { severity } : {}),
      ...(kind ? { kind } : {}),
    };
    next = next.map((finding) => (finding.id === first.id ? mergedFinding : finding));
    if (!acceptedIds.includes(first.id)) acceptedIds.push(first.id);
    mergedCount += 1;
  }
  return { findings: next, accepted: acceptedIds, merged: mergedCount };
}

function strongestSeverity(findings: readonly ExpertFinding[]): FindingSeverity | undefined {
  let best: FindingSeverity | undefined;
  for (const finding of findings) {
    if (finding.severity === undefined) continue;
    if (best === undefined || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[best]) {
      best = finding.severity;
    }
  }
  return best;
}

function mergedKind(findings: readonly ExpertFinding[]): FindingKind | undefined {
  if (findings.some((finding) => finding.kind === 'invariant')) return 'invariant';
  return findings.find((finding) => finding.kind !== undefined)?.kind;
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

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
