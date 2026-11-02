import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  auditGroupOf,
  AuditUsageError,
  lintAllAgents,
  lintAllSkills,
  parseGroupBy,
  runAudit,
} from '@/authoring/lint/audit.js';
import { listingSaving, renderAuditSection } from '@/authoring/lint/audit-report.js';
import { classifyAgentPath, isAgentTemplatePath, isPersonaRootPath } from '@/authoring/paths.js';
import { renderTemplateAgents, STAGE_AGENT_AUDIT_SOURCES } from '@/stage-isolation/agent-audit.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const SKILL = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\n1. Read the input.\n2. Write the result.\n`;

const AGENT = `---
name: migration-reviewer
description: 'Use this agent when a change adds a database migration, as in "review this migration".'
tools: Read, Grep, Glob
model: haiku
effort: low
maxTurns: 20
---

## Objective

Judge the migration.

## Procedure

1. Read it.

## Report

At most 400 tokens. Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.

## Stop when

It is judged.

## Do not

- Do not edit any file.

## Example

Input: <path>.
`;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
  roots.push(root);
  write(root, 'package.json', '{"name":"paqad-ai"}\n');
  write(
    root,
    '.paqad/onboarding-manifest.json',
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
  write(
    root,
    'runtime/base/skills/drafting-notes/SKILL.md',
    SKILL('drafting-notes', 'Drafts release notes. Use when the user asks for release notes.'),
  );
  write(
    root,
    'runtime/capabilities/coding/skills/reviewing-sql/SKILL.md',
    SKILL('reviewing-sql', 'Reviews SQL — fast. Use when a query changes.'),
  );
  write(root, '.claude/agents/migration-reviewer.md', AGENT);
  write(root, 'runtime/base/agents/router.md', '# Router\n\nYou route requests.\n');
  write(root, 'runtime/capabilities/coding/agents/qa-engineer.md', '# QA\n\nYou test.\n');
  return root;
}

describe('agent path classes', () => {
  it('classes a frontmatter-less file under a persona root as a persona', () => {
    expect(isPersonaRootPath('runtime/base/agents/router.md')).toBe(true);
    expect(isPersonaRootPath('runtime/capabilities/coding/agents/qa-engineer.md')).toBe(true);
    expect(classifyAgentPath('runtime/base/agents/router.md', false)).toBe('persona');
    expect(classifyAgentPath('runtime/base/agents/agent-orchestrator.md', true)).toBe('agent');
  });

  it('AC-29: a subagent path that lost its frontmatter stays an agent', () => {
    expect(classifyAgentPath('.claude/agents/paqad-development.md', false)).toBe('agent');
    expect(classifyAgentPath('runtime/claude-plugin/agents/paqad-review.md', false)).toBe('agent');
  });

  it('classes the stage-agent templates by path', () => {
    expect(isAgentTemplatePath('runtime/templates/stage-agents/claude.md.hbs')).toBe(true);
    expect(classifyAgentPath('runtime/templates/stage-agents/codex.toml.hbs', true)).toBe(
      'template',
    );
  });
});

describe('auditGroupOf', () => {
  it('names the catalog groups', () => {
    expect(auditGroupOf('runtime/base/skills')).toBe('base');
    expect(auditGroupOf('runtime/claude-plugin/agents')).toBe('plugin');
    expect(auditGroupOf('runtime/capabilities/security/skills')).toBe('security');
    expect(auditGroupOf('runtime/templates/stage-agents')).toBe('templates');
    expect(auditGroupOf('.claude/skills')).toBe('.claude/skills');
  });
});

describe('lintAllSkills', () => {
  it('lints every skill folder, sorted, with project-relative finding paths', () => {
    const report = lintAllSkills(fixture());
    expect(report.items.map((item) => item.path)).toEqual([
      'runtime/base/skills/drafting-notes',
      'runtime/capabilities/coding/skills/reviewing-sql',
    ]);
    const sql = report.items[1]!;
    expect(sql.group).toBe('coding');
    expect(sql.findings.map((finding) => finding.file)).toContain(
      'runtime/capabilities/coding/skills/reviewing-sql/SKILL.md',
    );
    expect(report.rules.find((rule) => rule.rule === 'SK-016')?.blocking).toBeGreaterThan(0);
    expect(report.groups.map((group) => group.key)).toEqual(
      [...report.groups.map((group) => group.key)].sort(),
    );
    expect(sql.listing_tokens).toBeGreaterThan(0);
    expect(sql.body_tokens).toBeGreaterThan(0);
    expect(sql.fired_30d).toBeNull();
  });

  it('takes a skill that starts only from its command out of the listing', () => {
    const root = fixture();
    write(
      root,
      'runtime/base/skills/opening-dashboards/SKILL.md',
      SKILL(
        'opening-dashboards',
        'Opens the dashboard. Use when the user asks for the dashboard.',
      ).replace('---\n#', 'disable-model-invocation: true\n---\n#'),
    );
    const report = lintAllSkills(root);
    const listed = report.items.map((item) => [item.name, item.listed]);
    expect(listed).toEqual([
      ['drafting-notes', true],
      ['opening-dashboards', false],
      ['reviewing-sql', true],
    ]);
    const saving = listingSaving(report);
    const dashboard = report.items[1]!.listing_tokens;
    expect(saving).toEqual({
      before: report.items.reduce((total, item) => total + item.listing_tokens, 0),
      after: saving.before - dashboard,
      saving: dashboard,
      unlisted: ['opening-dashboards'],
    });
    const after = renderAuditSection(
      { projectRoot: root, asOf: '2026-11-01', skills: report, agents: lintAllAgents(root) },
      'after',
      null,
    ).join('\n');
    expect(after).toContain('### Skill listing');
    expect(after).toContain(`| ${saving.before} | ${saving.after} | ${saving.saving} |`);
  });

  it('groups by folder on request', () => {
    const report = lintAllSkills(fixture(), { groupBy: 'folder' });
    expect(report.group_by).toBe('folder');
    expect(report.groups.map((group) => group.key)).toEqual([
      'runtime/capabilities/coding/skills/reviewing-sql',
    ]);
  });

  it('counts fires inside the 30-day window up to --as-of', () => {
    const root = fixture();
    const rows = [
      { skill: 'drafting-notes', at: '2026-10-30T10:00:00Z' },
      { skill: 'drafting-notes', at: '2026-08-01T10:00:00Z' },
    ].map((row) =>
      JSON.stringify({ ...row, request_id: null, session_id: null, source: 'Skill-tool' }),
    );
    write(root, '.paqad/ledger/authoring/activations.jsonl', `${rows.join('\n')}\n`);
    const report = lintAllSkills(root, { asOf: '2026-11-01' });
    expect(report.items.map((item) => item.fired_30d)).toEqual([1, 0]);
  });
});

describe('lintAllAgents', () => {
  it('lists personas apart and never blocks on them', () => {
    const report = lintAllAgents(fixture());
    expect(report.personas.map((persona) => persona.path)).toEqual([
      'runtime/base/agents/router.md',
      'runtime/capabilities/coding/agents/qa-engineer.md',
    ]);
    expect(report.items.map((item) => item.path)).toEqual(['.claude/agents/migration-reviewer.md']);
    expect(report.blocking).toBe(0);
  });

  it('AC-29: a subagent file without frontmatter blocks on AG-001', () => {
    const root = fixture();
    write(root, '.claude/agents/broken.md', '# Broken\n\nNo frontmatter.\n');
    const report = lintAllAgents(root);
    const broken = report.items.find((item) => item.path === '.claude/agents/broken.md');
    expect(broken?.findings.map((finding) => finding.rule)).toEqual(['AG-001']);
    expect(report.personas.some((persona) => persona.path.includes('broken'))).toBe(false);
  });
});

describe('the stage-agent templates', () => {
  it('render for both hosts before they are linted', () => {
    const claude = renderTemplateAgents('runtime/templates/stage-agents/claude.md.hbs');
    const codex = renderTemplateAgents('runtime/templates/stage-agents/codex.toml.hbs');
    expect(claude.map((agent) => agent.name)).toContain('paqad-development');
    expect(claude.every((agent) => agent.host === 'claude-code')).toBe(true);
    expect(codex.every((agent) => agent.host === 'codex')).toBe(true);
    const dev = codex.find((agent) => agent.name === 'paqad-development')!;
    expect(dev.path).toBe('runtime/templates/stage-agents/codex.toml.hbs#paqad-development');
    expect(dev.content.startsWith('---\nname: paqad-development\ndescription: ')).toBe(true);
  });

  it('are linted as rendered files with no Codex tool-power finding', () => {
    const root = fixture();
    write(root, 'runtime/templates/stage-agents/claude.md.hbs', 'x');
    write(root, 'runtime/templates/stage-agents/codex.toml.hbs', 'x');
    const report = lintAllAgents(root, { agentSources: STAGE_AGENT_AUDIT_SOURCES });
    const templates = report.items.filter((item) => item.class === 'template');
    expect(templates.length).toBeGreaterThan(0);
    const codex = templates.filter((item) => item.path.includes('codex.toml.hbs#'));
    expect(codex.flatMap((item) => item.findings).some((f) => f.rule === 'AG-022')).toBe(false);
  });
});

describe('runAudit', () => {
  it('AC-1: writes byte-identical reports across runs and checkouts', () => {
    const first = fixture();
    const second = mkdtempSync(join(tmpdir(), 'paqad-audit-copy-'));
    roots.push(second);
    cpSync(first, second, { recursive: true });
    const read = (root: string, kind: 'skill' | 'agent'): string => {
      runAudit(root, kind, { report: `out-${kind}.json` });
      return readFileSync(join(root, `out-${kind}.json`), 'utf8');
    };
    for (const kind of ['skill', 'agent'] as const) {
      const once = read(first, kind);
      expect(read(first, kind)).toBe(once);
      expect(read(second, kind)).toBe(once);
      expect(once).not.toContain(first);
      expect(once).not.toContain(second);
    }
  });

  it('refuses an unknown --group-by or a bad --as-of', () => {
    expect(() => parseGroupBy('team')).toThrow(AuditUsageError);
    expect(() => runAudit(fixture(), 'skill', { asOf: 'yesterday' })).toThrow(AuditUsageError);
  });
});
