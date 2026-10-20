import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_ROLES, type AgentRole } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import {
  DEFAULT_STANDING_EXPERTS,
  EXPERT_ROLES,
  isExpertRole,
} from '@/spec-pipeline/experts/roster.js';

export type RegistryTier = 'standing' | 'on-call' | 'chair' | 'machinery';

export interface AgentRegistryRow {
  role: AgentRole;
  tier: RegistryTier;
  budget: number;
  persona: string;
  lens: string;
}

const PERSONA_DIRS = [
  'base/agents',
  'capabilities/coding/agents',
  'capabilities/security/agents',
] as const;

const LENS_DIR = 'base/skills/expert-notes/references/lenses';

const PERSONA_ALIASES: Partial<Record<AgentRole, string | null>> = {
  'db-expert': 'database-expert',
  implementer: null,
  reviewer: null,
};

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

export function collectAgentRegistryRows(runtimeRoot: string): AgentRegistryRow[] {
  return AGENT_ROLES.map((role) => ({
    role,
    tier: tierOf(role),
    budget: ROLE_TOKEN_BUDGETS[role],
    persona: personaPathOf(runtimeRoot, role),
    lens: lensPathOf(runtimeRoot, role),
  }));
}

export function collectReusedPersonaRows(runtimeRoot: string): { name: string; persona: string }[] {
  return REUSED_PERSONAS.map((stem) => ({
    name: stem,
    persona: locatePersona(runtimeRoot, stem) ?? 'none yet',
  }));
}

const REGISTRY_HEADER =
  '<!-- managed by paqad-ai — generated from src/onboarding/agent-registry-writer.ts. Do not edit by hand. -->';

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
    "fired; machinery roles are the pipeline's own build-time helpers. Generated so the roster, the",
    'persona files, and the README table cannot drift.',
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

export function buildAgentRegistryDocument(runtimeRoot: string): string {
  return renderAgentRegistry(
    collectAgentRegistryRows(runtimeRoot),
    collectReusedPersonaRows(runtimeRoot),
  );
}

export const REGISTRY_EXPERT_ROLES = EXPERT_ROLES;
