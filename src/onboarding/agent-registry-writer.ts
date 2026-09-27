// The agent-roster registry (issue #558, FR-11).
//
// Three descriptions of the roster used to disagree: `AGENT_ROLES`, the persona files on disk,
// and the README table. This renders ONE generated page from the canonical `AGENT_ROLES`, the
// expert roster, and the token budgets, plus the persona and lens files that back each role, so a
// reader (and the drift test) has one source of truth. Pure and deterministic (INV-4): the row
// data is resolved against the runtime tree once, then rendered with zero model tokens.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_ROLES, type AgentRole } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import {
  DEFAULT_STANDING_EXPERTS,
  EXPERT_ROLES,
  isExpertRole,
} from '@/spec-pipeline/experts/roster.js';

/** The tier a role sits in on the registry page. */
export type RegistryTier = 'standing' | 'on-call' | 'chair' | 'machinery';

/** One rendered roster row. */
export interface AgentRegistryRow {
  role: AgentRole;
  tier: RegistryTier;
  budget: number;
  /** Project-relative persona path, or `none yet` for a role with no persona. */
  persona: string;
  /** Project-relative lens path, or `n/a` for a non-expert role. */
  lens: string;
}

/** The directories, in search order, that hold persona files (runtime-relative). */
const PERSONA_DIRS = [
  'base/agents',
  'capabilities/coding/agents',
  'capabilities/security/agents',
] as const;

/** The lens directory (runtime-relative). */
const LENS_DIR = 'base/skills/expert-notes/references/lenses';

/**
 * Roles whose persona file is named differently from the role id, or that have no persona yet.
 * `null` ⇒ `none yet`.
 */
const PERSONA_ALIASES: Partial<Record<AgentRole, string | null>> = {
  'db-expert': 'database-expert',
  implementer: null,
  reviewer: null,
};

/** The persona files that back no role id — reused by the roles above (issue #558, FR-11.1). */
const REUSED_PERSONAS = [
  'router',
  'story-designer',
  'final-reviewer',
  'adversarial-reviewer',
  'app-cartographer',
  'journey-designer',
] as const;

const RUNTIME_ROOT_PREFIX = 'runtime';

function tierOf(role: AgentRole): RegistryTier {
  if (role === 'chief-architect') return 'chair';
  if (DEFAULT_STANDING_EXPERTS.includes(role)) return 'standing';
  if (isExpertRole(role)) return 'on-call';
  return 'machinery';
}

/** Find the runtime-relative persona path for a role, or `none yet` when it has none. */
function personaPathOf(runtimeRoot: string, role: AgentRole): string {
  if (role in PERSONA_ALIASES) {
    const alias = PERSONA_ALIASES[role];
    if (alias === null || alias === undefined) return 'none yet';
    return locatePersona(runtimeRoot, alias) ?? 'none yet';
  }
  return locatePersona(runtimeRoot, role) ?? 'none yet';
}

function locatePersona(runtimeRoot: string, fileStem: string): string | null {
  for (const dir of PERSONA_DIRS) {
    const rel = `${RUNTIME_ROOT_PREFIX}/${dir}/${fileStem}.md`;
    if (existsSync(join(runtimeRoot, dir, `${fileStem}.md`))) return rel;
  }
  return null;
}

function lensPathOf(runtimeRoot: string, role: AgentRole): string {
  if (!isExpertRole(role)) return 'n/a';
  const rel = `${RUNTIME_ROOT_PREFIX}/${LENS_DIR}/${role}.md`;
  return existsSync(join(runtimeRoot, LENS_DIR, `${role}.md`)) ? rel : 'n/a';
}

/**
 * Resolve one row per `AGENT_ROLES` entry against the runtime tree. Deterministic given the same
 * tree (INV-4). `runtimeRoot` is the framework install's `runtime/` directory.
 */
export function collectAgentRegistryRows(runtimeRoot: string): AgentRegistryRow[] {
  return AGENT_ROLES.map((role) => ({
    role,
    tier: tierOf(role),
    budget: ROLE_TOKEN_BUDGETS[role],
    persona: personaPathOf(runtimeRoot, role),
    lens: lensPathOf(runtimeRoot, role),
  }));
}

/** The reused-persona rows (personas with no role id). */
export function collectReusedPersonaRows(runtimeRoot: string): { name: string; persona: string }[] {
  return REUSED_PERSONAS.map((stem) => ({
    name: stem,
    persona: locatePersona(runtimeRoot, stem) ?? 'none yet',
  }));
}

const REGISTRY_HEADER =
  '<!-- managed by paqad-ai — generated from src/onboarding/agent-registry-writer.ts. Do not edit by hand. -->';

/** Render the roster registry markdown from resolved rows. Pure; zero model tokens. */
export function renderAgentRegistry(
  rows: AgentRegistryRow[],
  reused: { name: string; persona: string }[],
): string {
  const lines: string[] = [
    REGISTRY_HEADER,
    '',
    '# Agent roster',
    '',
    `The ${rows.length} built-in specialist roles, one row per \`AGENT_ROLES\` entry. Standing experts sit`,
    'at every spec run; on-call experts are picked by the detector; the chair runs whenever any expert',
    'fired; machinery roles are the pipeline\'s own build-time helpers. Generated so the roster, the',
    'persona files, and the README table cannot drift (issue #558).',
    '',
    '| Role | Tier | Budget | Persona | Lens |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) => `| ${row.role} | ${row.tier} | ${row.budget} | ${row.persona} | ${row.lens} |`,
    ),
    '',
    '## Personas the roles reuse',
    '',
    `${reused.length} persona files back no role id of their own; the roles above reuse them.`,
    '',
    '| Persona | File |',
    '| --- | --- |',
    ...reused.map((row) => `| ${row.name} | ${row.persona} |`),
    '',
  ];
  return lines.join('\n');
}

/** Build the full registry document for a runtime tree. */
export function buildAgentRegistryDocument(runtimeRoot: string): string {
  return renderAgentRegistry(
    collectAgentRegistryRows(runtimeRoot),
    collectReusedPersonaRows(runtimeRoot),
  );
}

/** The expert roles that must each have a lens (issue #558, AC-14) — re-exported for the drift test. */
export const REGISTRY_EXPERT_ROLES = EXPERT_ROLES;
