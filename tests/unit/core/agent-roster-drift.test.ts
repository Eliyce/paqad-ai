import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from '@/core/types/agent.js';
import { EXPERT_ROLES } from '@/spec-pipeline/experts/roster.js';
import {
  buildAgentRegistryDocument,
  collectAgentRegistryRows,
  collectReusedPersonaRows,
} from '@/onboarding/agent-registry-writer.js';

const REPO_ROOT = process.cwd();
const RUNTIME_ROOT = join(REPO_ROOT, 'runtime');

// The persona file that backs each expert role, when it is not `<role>.md` (issue #558, FR-11.3).
const PERSONA_ALIAS: Record<string, string> = {
  'db-expert': 'runtime/capabilities/coding/agents/database-expert.md',
  'product-owner': 'runtime/base/agents/product-owner.md',
  'security-auditor': 'runtime/capabilities/security/agents/security-auditor.md',
};

const PERSONA_DIRS = [
  'runtime/base/agents',
  'runtime/capabilities/coding/agents',
  'runtime/capabilities/security/agents',
];

function personaExists(role: string): boolean {
  if (PERSONA_ALIAS[role]) return existsSync(join(REPO_ROOT, PERSONA_ALIAS[role]));
  return PERSONA_DIRS.some((dir) => existsSync(join(REPO_ROOT, dir, `${role}.md`)));
}

function lensExists(role: string): boolean {
  return existsSync(join(RUNTIME_ROOT, 'base/skills/expert-notes/references/lenses', `${role}.md`));
}

describe('agent roster drift (issue #558)', () => {
  it('AGENT_ROLES has exactly 22 roles', () => {
    expect(AGENT_ROLES.length).toBe(22);
  });

  it('every expert role has a persona file', () => {
    for (const role of EXPERT_ROLES) {
      expect(personaExists(role), `missing persona for ${role}`).toBe(true);
    }
  });

  it('every expert role has a lens file (13 experts)', () => {
    expect(EXPERT_ROLES.length).toBe(13);
    for (const role of EXPERT_ROLES) {
      expect(lensExists(role), `missing lens for ${role}`).toBe(true);
    }
  });

  it('the README and the module summary carry the role count', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('22 built-in specialist roles');
    const summary = readFileSync(
      join(REPO_ROOT, 'docs/modules/agent-runtime/index/summary.md'),
      'utf8',
    );
    expect(summary).toContain('22 roles');
  });

  it('the registry renders one row per role and six reused personas', () => {
    const rows = collectAgentRegistryRows(RUNTIME_ROOT);
    expect(rows).toHaveLength(22);
    expect(rows.every((row) => row.role.length > 0)).toBe(true);
    const reused = collectReusedPersonaRows(RUNTIME_ROOT);
    expect(reused).toHaveLength(6);
  });

  it('the committed registry page matches the renderer', async () => {
    const doc = buildAgentRegistryDocument(RUNTIME_ROOT);
    await expect(doc).toMatchFileSnapshot('../../../docs/instructions/registries/agents.md');
  });
});
