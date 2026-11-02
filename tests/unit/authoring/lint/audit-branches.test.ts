import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AuditUsageError,
  lintAllAgents,
  lintAllSkills,
  listProjectFiles,
  parseGroupBy,
  runAudit,
  type AuditItem,
  type AuditReport,
} from '@/authoring/lint/audit.js';
import { LENS_ROOT, renderAuditDoc, writeAuditDoc } from '@/authoring/lint/audit-report.js';
import type { LintFinding } from '@/authoring/lint/runner.js';
import { DELEGATIONS_LEDGER } from '@/authoring/delegations.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-audit-branches-'));
  roots.push(root);
  return root;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function finding(rule: string, severity: 'block' | 'warn' = 'warn'): LintFinding {
  return { rule, severity, file: 'SKILL.md', message: rule } as LintFinding;
}

function item(over: Partial<AuditItem> & Pick<AuditItem, 'name' | 'path'>): AuditItem {
  return {
    group: 'base',
    class: 'skill',
    blocking: 0,
    warnings: 0,
    body_tokens: 10,
    listing_tokens: 5,
    listed: true,
    rival: null,
    script_test_findings: 0,
    fired_30d: null,
    findings: [],
    ...over,
  };
}

function report(kind: 'skill' | 'agent', items: AuditItem[], personas = false): AuditReport {
  return {
    kind,
    group_by: 'rule',
    as_of: '2026-11-01',
    items_count: items.length,
    blocking: 0,
    warnings: 0,
    rules: [
      { rule: 'SK-004', blocking: 0, warnings: 1 },
      { rule: 'SK-001', blocking: 1, warnings: 0 },
    ],
    groups: [],
    items,
    personas: personas
      ? [{ name: 'router', path: 'runtime/base/agents/router.md', group: 'base', body_tokens: 3 }]
      : [],
  } as AuditReport;
}

const OWNS = 'Reviews database migrations for locking and rollback safety in production.';

function projectWithAgentsAndLenses(): string {
  const root = tmp();
  for (const name of ['beta', 'alpha', 'gamma']) {
    write(
      root,
      `.claude/agents/${name}.md`,
      `---\nname: ${name}\ndescription: '${OWNS}'\n---\nBody\n`,
    );
  }
  write(root, `${LENS_ROOT}/data.md`, `# Data\n\n## What you look for\n\n${OWNS}\n\n## Other\n`);
  write(root, `${LENS_ROOT}/notes.txt`, 'not a lens');
  write(root, 'skills/tested/SKILL.md', '---\nname: tested\ndescription: Tested.\n---\nBody\n');
  write(root, 'skills/tested/scripts/run.sh', 'echo ok\n');
  write(root, 'skills/listdesc/SKILL.md', '---\nname: listdesc\ndescription: [a, b]\n---\nBody\n');
  write(root, 'skills/listdesc/scripts/run.sh', 'echo ok\n');
  mkdirSync(join(root, 'skills/empty/scripts'), { recursive: true });
  return root;
}

function reports(): { skills: AuditReport; agents: AuditReport } {
  const skills = report('skill', [
    item({
      name: 'tested',
      path: 'skills/tested',
      fired_30d: 4,
      rival: { name: 'listdesc', score: 0.5 },
      findings: [finding('SK-004'), finding('SK-004'), finding('SK-001', 'block')],
    }),
    item({ name: 'listdesc', path: 'skills/listdesc', script_test_findings: 2, listed: false }),
    item({ name: 'missing', path: 'skills/missing', group: 'plugin' }),
    item({ name: 'empty', path: 'skills/empty' }),
  ]);
  const agent = (name: string): AuditItem =>
    item({ name, path: `.claude/agents/${name}.md`, class: 'agent', group: 'claude' });
  const agents = report(
    'agent',
    [
      agent('beta'),
      agent('alpha'),
      agent('alpha'),
      agent('gamma'),
      agent('gone'),
      item({ name: 'tpl', path: 'runtime/templates/x#tpl', class: 'template', group: 'templates' }),
    ],
    true,
  );
  return { skills, agents };
}

describe('renderAuditDoc branches', () => {
  it('renders the Before section with rivals, script states, naming and listing data', () => {
    const root = projectWithAgentsAndLenses();
    const { skills, agents } = reports();
    const doc = renderAuditDoc({ projectRoot: root, asOf: '2026-11-01', skills, agents });
    expect(doc).toContain('## Before');
    expect(doc).toContain('no scripts');
    expect(doc).toContain('2 SK-010');
    expect(doc).toContain('| tested |');
    expect(doc).toContain('SK-004');
    expect(doc).toContain('listdesc (0.50)');
    expect(doc).toContain('alpha (1.00)');
    expect(doc).toContain('### Personas');
    expect(doc).toContain('audit-body-tokens');
  });

  it('renders the After section against a kept Before, with drops, new rows and packets', () => {
    const root = projectWithAgentsAndLenses();
    const { skills, agents } = reports();
    const previous = [
      '# Skill and agent audit',
      '',
      '## Before',
      '',
      `<!-- audit-body-tokens ${JSON.stringify({ 'skills/tested': 30 })} -->`,
      '',
      '## After',
      '',
      'old',
    ].join('\n');
    const doc = renderAuditDoc({
      projectRoot: root,
      asOf: '2026-11-02',
      skills,
      agents: { ...agents, personas: [] },
      previous,
      exceptions: new Map([['SK-001:tested', 'D-7']]),
    });
    expect(doc).toContain('Body tokens before');
    expect(doc).toContain('D-7');
    expect(doc).toContain('| new |');
    expect(doc).toContain('### Skill listing');
    expect(doc).not.toContain('### Personas');
    expect(doc).not.toContain('\nold');
  });

  it('keeps a Before with no After heading and no token data, and forces After without one', () => {
    const root = tmp();
    const empty = report('skill', []);
    const agents = report('agent', []);
    const kept = renderAuditDoc({
      projectRoot: root,
      asOf: '2026-11-02',
      skills: empty,
      agents,
      previous: '# Audit\n\n## Before\n\nno data\n',
    });
    expect(kept).toContain('no data');
    expect(kept).toContain('## After');
    expect(kept).not.toContain('### Skill listing');

    const forced = renderAuditDoc({
      projectRoot: root,
      asOf: '2026-11-02',
      skills: empty,
      agents,
      previous: 'no headings at all',
      section: 'after',
    });
    expect(forced).toContain('## After');
    expect(forced).not.toContain('## Before');
  });

  it('refuses a section that is neither before nor after', () => {
    expect(() => writeAuditDoc(tmp(), { asOf: '2026-11-01', section: 'during' as never })).toThrow(
      AuditUsageError,
    );
  });
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

describe('lint --all branches', () => {
  it('lists files from git, dropping deleted paths, when the project is a repository', () => {
    const root = tmp();
    write(root, 'runtime/base/skills/a/SKILL.md', '---\nname: a\ndescription: A.\n---\nBody\n');
    write(root, 'gone.txt', 'x');
    execFileSync('git', ['init', '-q'], { cwd: root, env: GIT_ENV });
    execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV });
    rmSync(join(root, 'gone.txt'));
    const files = listProjectFiles(root, ['runtime/base/skills']);
    expect(files).toContain('runtime/base/skills/a/SKILL.md');
    expect(files).not.toContain('gone.txt');
  });

  it('breaks rival ties by name and skips a listed folder without SKILL.md', () => {
    const root = tmp();
    write(root, 'package.json', '{"name":"paqad-ai"}\n');
    write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    const same = 'Drafts release notes from merged pull requests. Use when notes are asked for.';
    for (const name of ['zeta', 'beta', 'alpha']) {
      write(
        root,
        `runtime/base/skills/${name}/SKILL.md`,
        `---\nname: ${name}\ndescription: ${same}\n---\nBody\n`,
      );
    }
    const files = [
      'runtime/base/skills/zeta/SKILL.md',
      'runtime/base/skills/beta/SKILL.md',
      'runtime/base/skills/alpha/SKILL.md',
      'runtime/base/skills/ghost/SKILL.md',
    ];
    const result = lintAllSkills(root, { files });
    expect(result.items.map((i) => i.name)).toEqual(['alpha', 'beta', 'zeta']);
    expect(result.items.find((i) => i.name === 'zeta')?.rival?.name).toBe('alpha');
    expect(result.items.find((i) => i.name === 'alpha')?.rival?.name).toBe('beta');
  });

  it('skips Codex TOML and vanished agents, reads a list description, softens owner powers', () => {
    const root = tmp();
    write(root, 'package.json', '{"name":"paqad-ai"}\n');
    write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    write(
      root,
      '.claude/agents/wide.md',
      '---\nname: wide\ndescription: [a, b]\ntools: Bash, Write, Edit\npermissionMode: bypassPermissions\n---\nBody\n',
    );
    write(root, '.codex/agents/x.toml', 'name = "x"\n');
    const files = ['.claude/agents/wide.md', '.claude/agents/vanished.md', '.codex/agents/x.toml'];
    const strict = lintAllAgents(root, { files });
    expect(strict.items.map((i) => i.path)).toEqual(['.claude/agents/wide.md']);
    const soft = lintAllAgents(root, { files, ownerPowersAsWarnings: true });
    expect(soft.blocking).toBeLessThan(strict.blocking);
  });

  it('accepts a known --group-by and writes the agent report to its default path', () => {
    expect(parseGroupBy('folder')).toBe('folder');
    const root = tmp();
    write(root, 'package.json', '{"name":"paqad-ai"}\n');
    write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    const result = runAudit(root, 'agent', { asOf: '2026-11-01' });
    expect(readFileSync(join(root, result.reportPath), 'utf8')).toContain('"kind"');
    expect(result.summary).toContain('0 personas listed apart');
  });

  it('counts agent fires from the delegation ledger inside the window', () => {
    const root = tmp();
    write(root, 'package.json', '{"name":"paqad-ai"}\n');
    write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    write(
      root,
      '.claude/agents/wide.md',
      "---\nname: wide\ndescription: 'Use this agent for wide reviews.'\n---\nBody\n",
    );
    const row = (at: string) =>
      JSON.stringify({
        agent: 'paqad:wide',
        request_id: null,
        session_id: null,
        at,
        tokens: null,
        duration_ms: null,
        status: 'completed',
      });
    write(
      root,
      DELEGATIONS_LEDGER,
      `${row('2026-10-30T10:00:00.000Z')}\n${row('2020-01-01T00:00:00.000Z')}\n`,
    );
    const result = lintAllAgents(root, {
      asOf: '2026-11-01',
      files: ['.claude/agents/wide.md'],
    });
    expect(result.items[0]?.fired_30d).toBe(1);
  });
});
