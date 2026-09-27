// Validate the model's expert-need decision (issue #521, FR-3 / FR-4 / AC-2 / AC-8).
//
// This is the whole "one change" made safe: the fast-tier `expert-need-detector` skill DECIDES
// which experts a request needs (a script cannot tell reliably and would emit false signals),
// and this module is the deterministic guard around that decision. It does not score signals and
// it does not second-guess the judgement — it only checks the returned artifact is well-formed
// and names nothing outside the roster, so the model can never invent an expert (P2-INV-2/3).

import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertNeed, ExpertNeedArtifact } from './types.js';
import { isExpertRole } from './roster.js';

/**
 * Seat the configured standing experts alongside the detector's picks (issue #558, FR-2.3). Every
 * standing role the detector did not already name is appended with `origin: 'standing'` and the
 * fixed reason; a role the detector named is left as-is (`origin: 'detector'`), so it appears once
 * (AC-4). Detector picks keep their order and lead; standing roles follow. Deterministic (INV-4).
 */
export function seatStandingExperts(
  detectorNeeds: readonly ExpertNeed[],
  standing: readonly AgentRole[],
): ExpertNeed[] {
  const named = new Set(detectorNeeds.map((need) => need.role));
  const seated: ExpertNeed[] = detectorNeeds.map((need) => ({ ...need, origin: 'detector' }));
  for (const role of standing) {
    if (named.has(role)) continue;
    named.add(role);
    seated.push({ role, reason: 'standing expert (always at the table)', origin: 'standing' });
  }
  return seated;
}

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
    const { role, reason, origin } = entry as Record<string, unknown>;
    // The chief architect is never picked (issue #547, FR-2.4): it runs automatically once any
    // expert fired. A need artifact that names it is refused with its own message, before the
    // generic roster rejection, so the detector's mistake is unambiguous.
    if (role === 'chief-architect') {
      return fail('"chief-architect" is never picked: it runs automatically when any expert fires');
    }
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
    // Preserve a recorded origin on a round-trip through the roster (issue #558, FR-2.1); a raw
    // detector artifact carries none, so it defaults to `detector`. The script appends any standing
    // experts afterwards, at record time.
    normalized.push({
      role,
      reason: reason.trim(),
      origin: origin === 'standing' ? 'standing' : 'detector',
    });
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
