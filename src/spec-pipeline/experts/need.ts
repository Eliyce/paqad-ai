import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertNeed, ExpertNeedArtifact } from './types.js';
import { isExpertRole } from './roster.js';

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

export const SENSITIVE_PATH_EXPERT: AgentRole = 'security-auditor';

export const SKILL_PATH_EXPERT: AgentRole = 'skill-orchestrator';

export interface PathTriggeredSeat {
  role: AgentRole;
  path: string | null;
  reason: string;
}

export function pathTriggeredSeats(input: {
  standingSits: boolean;
  sensitivePath: string | null;
  skillPath: string | null;
}): PathTriggeredSeat[] {
  return [
    {
      role: SENSITIVE_PATH_EXPERT,
      path: input.standingSits ? null : input.sensitivePath,
      reason: `a planned path is sensitive: ${input.sensitivePath}`,
    },
    {
      role: SKILL_PATH_EXPERT,
      path: input.skillPath,
      reason: `a planned file is a skill: ${input.skillPath}`,
    },
  ];
}

export interface LaneSeatingInput {
  detectorNeeds: readonly ExpertNeed[];
  standing: readonly AgentRole[];
  standingSits: boolean;
  pathSeats: readonly PathTriggeredSeat[];
}

export function seatExpertsForLane(input: LaneSeatingInput): ExpertNeed[] {
  const seated = seatStandingExperts(input.detectorNeeds, input.standingSits ? input.standing : []);
  for (const seat of input.pathSeats) {
    if (seat.path === null || seated.some((need) => need.role === seat.role)) continue;
    seated.push({ role: seat.role, reason: seat.reason, origin: 'detector' });
  }
  return seated;
}

export interface ExpertNeedValidation {
  ok: boolean;
  error?: string;
  artifact?: ExpertNeedArtifact;
}

function fail(error: string): ExpertNeedValidation {
  return { ok: false, error };
}

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
