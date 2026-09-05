// Validate the model's expert-need decision (issue #521, FR-3 / FR-4 / AC-2 / AC-8).
//
// This is the whole "one change" made safe: the fast-tier `expert-need-detector` skill DECIDES
// which experts a request needs (a script cannot tell reliably and would emit false signals),
// and this module is the deterministic guard around that decision. It does not score signals and
// it does not second-guess the judgement — it only checks the returned artifact is well-formed
// and names nothing outside the roster, so the model can never invent an expert (P2-INV-2/3).

import type { ExpertNeed, ExpertNeedArtifact } from './types.js';
import { isExpertRole } from './roster.js';

/** The outcome of validating a model-produced need artifact. */
export interface ExpertNeedValidation {
  ok: boolean;
  /** Present when `ok` is false — the actionable reason, in one line. */
  error?: string;
  /** The normalized artifact, present only when `ok` is true. */
  artifact?: ExpertNeedArtifact;
}

function fail(error: string): ExpertNeedValidation {
  return { ok: false, error };
}

/**
 * Validate a raw expert-need artifact (already JSON-parsed, or a string to parse). Rejects, with
 * a one-line reason and nothing recorded:
 *   - anything that is not an object with an `experts` array;
 *   - an entry that is not `{ role, reason }` with non-empty strings;
 *   - a `role` outside the expert roster (AC-8 — the model may not invent an expert);
 *   - a duplicate role (one decision per expert).
 * On success it returns the normalized artifact (roles narrowed to `AgentRole`). An empty
 * `experts` array is VALID — nothing needed ⇒ zero experts (AC-4 / issue #521 §4).
 */
export function validateExpertNeed(raw: unknown): ExpertNeedValidation {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (parsed === undefined) {
    return fail('expert-need artifact is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('expert-need artifact must be an object with an experts[] array');
  }
  const experts = (parsed as Record<string, unknown>).experts;
  if (!Array.isArray(experts)) {
    return fail('expert-need artifact needs an experts[] array');
  }

  const seen = new Set<string>();
  const normalized: ExpertNeed[] = [];
  for (const [index, entry] of experts.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail(`experts[${index}] must be an object with role and reason`);
    }
    const { role, reason } = entry as Record<string, unknown>;
    if (typeof role !== 'string' || !isExpertRole(role)) {
      return fail(
        `experts[${index}].role "${String(role)}" is not an expert in the roster — the detector may not invent an expert (AC-8)`,
      );
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return fail(`experts[${index}] ("${role}") needs a non-empty reason it fired (FR-7)`);
    }
    if (seen.has(role)) {
      return fail(`experts names "${role}" twice — one decision per expert`);
    }
    seen.add(role);
    normalized.push({ role, reason: reason.trim() });
  }

  return { ok: true, artifact: { experts: normalized } };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
