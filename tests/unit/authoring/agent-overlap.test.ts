import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashAgentFile } from '@/authoring/hash.js';
import {
  AGENT_SCOPE_PRECEDENCE,
  discoverInstalledAgents,
  findNameShadowing,
  findSubsetOverlaps,
  shadowingLine,
} from '@/authoring/overlap.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-overlap-'));
  roots.push(root);
  return root;
}

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
}

describe('discoverInstalledAgents', () => {
  it('reads Claude Code Markdown and Codex TOML agents in project and user scope', () => {
    const root = tmp();
    const home = tmp();
    put(
      root,
      '.claude/agents/code-reviewer.md',
      '---\nname: code-reviewer\ndescription: Reviews code\n---\nBody\n',
    );
    put(root, '.claude/agents/nameless.md', 'no frontmatter\n');
    put(
      root,
      '.codex/agents/db-reader.toml',
      'name = "db-reader"\ndescription = "Reads the \\"db\\""\n',
    );
    put(root, '.codex/agents/plain.toml', 'developer_instructions = "x"\n');
    mkdirSync(join(root, '.claude/agents/folder'), { recursive: true });
    put(root, '.cursor/agents/ignored.md', '---\nname: ignored\ndescription: x\n---\n');
    put(
      home,
      '.claude/agents/code-reviewer.md',
      '---\nname: code-reviewer\ndescription: Mine\n---\n',
    );
    const found = discoverInstalledAgents(
      root,
      { adapters: ['claude-code', 'codex-cli', 'cursor'], paqadRepo: false },
      { userHome: home },
    );
    expect(found.map((agent) => [agent.name, agent.scope, agent.path, agent.description])).toEqual([
      ['code-reviewer', 'project', '.claude/agents/code-reviewer.md', 'Reviews code'],
      ['nameless', 'project', '.claude/agents/nameless.md', ''],
      ['db-reader', 'project', '.codex/agents/db-reader.toml', 'Reads the "db"'],
      ['plain', 'project', '.codex/agents/plain.toml', ''],
      ['code-reviewer', 'user', '~/.claude/agents/code-reviewer.md', 'Mine'],
    ]);
    expect(
      discoverInstalledAgents(
        root,
        { adapters: ['claude-code'], paqadRepo: false },
        { userHome: null },
      ),
    ).toHaveLength(2);
  });

  it('includes the paqad runtime agents in the paqad repo', () => {
    const root = tmp();
    put(
      root,
      'runtime/base/agents/agent-orchestrator.md',
      '---\nname: agent-orchestrator\ndescription: d\n---\n',
    );
    const found = discoverInstalledAgents(
      root,
      { adapters: [], paqadRepo: true },
      { userHome: null },
    );
    expect(found.map((agent) => agent.path)).toEqual(['runtime/base/agents/agent-orchestrator.md']);
  });
});

describe('agent name shadowing', () => {
  it('lets project agents win over user and plugin agents, and managed over project', () => {
    expect(AGENT_SCOPE_PRECEDENCE).toEqual(['managed', 'cli', 'project', 'user', 'plugin']);
    const candidate = {
      kind: 'agent' as const,
      name: 'code-reviewer',
      text: 'x',
      scope: 'project' as const,
    };
    const [user] = findNameShadowing(candidate, [
      {
        kind: 'agent',
        name: 'code-reviewer',
        description: '',
        path: '~/.claude/agents/code-reviewer.md',
        scope: 'user',
      },
    ]);
    expect(shadowingLine(user!)).toBe(
      'The name code-reviewer is taken in another scope: the new project one would shadow ~/.claude/agents/code-reviewer.md (user). Pick another name.',
    );
    const [managed] = findNameShadowing(candidate, [
      {
        kind: 'agent',
        name: 'code-reviewer',
        description: '',
        path: '/etc/claude/agents/code-reviewer.md',
        scope: 'managed',
      },
    ]);
    expect(managed!.shadowing.scope).toBe('managed');
  });
});

describe('hashAgentFile', () => {
  it('changes when the agent file or a named hook script changes, and marks a missing script', () => {
    const root = tmp();
    put(root, '.claude/agents/a.md', 'A\n');
    put(root, 'hooks/h.mjs', 'H\n');
    const first = hashAgentFile(root, '.claude/agents/a.md', ['hooks/h.mjs']);
    expect(hashAgentFile(root, '.claude/agents/a.md', ['hooks/h.mjs', 'hooks/h.mjs'])).toBe(first);
    put(root, 'hooks/h.mjs', 'H2\n');
    const second = hashAgentFile(root, '.claude/agents/a.md', ['hooks/h.mjs']);
    expect(second).not.toBe(first);
    const missing = hashAgentFile(root, '.claude/agents/a.md', ['hooks/gone.mjs']);
    expect(missing).not.toBe(hashAgentFile(root, '.claude/agents/a.md'));
  });

  it('AC-68: the hash binds the contents, not the path, so a draft copy and its released file match', () => {
    const root = tmp();
    put(root, '.claude/agents/a.md', 'A\n');
    put(root, 'hooks/h.mjs', 'H\n');
    put(root, 'draft/a.md', 'A\n');
    put(root, 'draft/hooks/h.mjs', 'H\n');
    const released = hashAgentFile(root, '.claude/agents/a.md', ['hooks/h.mjs']);
    const draft = hashAgentFile(root, 'draft/a.md', ['hooks/h.mjs'], join(root, 'draft'));
    expect(draft).toBe(released);
    put(root, 'draft/hooks/h.mjs', 'H2\n');
    expect(hashAgentFile(root, 'draft/a.md', ['hooks/h.mjs'], join(root, 'draft'))).not.toBe(
      released,
    );
  });
});

describe('discoverInstalledAgents edges', () => {
  it('reads a YAML tools list, skips a hidden file and scans the home folder by default', () => {
    const root = tmp();
    const home = tmp();
    put(
      root,
      '.claude/agents/lister.md',
      '---\nname: lister\ndescription: Lists\ntools:\n  - Read\n  - 7\n  - Grep\n---\n',
    );
    put(root, '.claude/agents/.hidden.md', 'not an agent\n');
    put(home, '.claude/agents/mine.md', '---\nname: mine\ndescription: Mine\n---\n');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    try {
      const found = discoverInstalledAgents(root, { adapters: ['claude-code'], paqadRepo: false });
      expect(found.map((agent) => [agent.name, agent.tools])).toEqual([
        ['lister', ['Read', 'Grep']],
        ['mine', undefined],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('findSubsetOverlaps (AC-13)', () => {
  const installed = (tools: string[], description: string) => [
    {
      kind: 'agent' as const,
      name: 'b',
      description,
      path: '.claude/agents/b.md',
      scope: 'project' as const,
      tools,
    },
  ];

  it('flags an agent whose tools and job sit inside an installed one', () => {
    expect(
      findSubsetOverlaps(
        { name: 'a', job: 'review migration', tools: ['Read'] },
        installed(['Read', 'Grep'], 'we review every migration'),
      ),
    ).toEqual([
      {
        candidate: 'a',
        existing: 'b',
        existing_path: '.claude/agents/b.md',
        score: 1,
        subset: true,
      },
    ]);
  });

  it('skips an installed agent missing one of the tools, or with a different job', () => {
    expect(
      findSubsetOverlaps(
        { name: 'a', job: 'review migration', tools: ['Read', 'Bash'] },
        installed(['Read'], 'we review every migration'),
      ),
    ).toEqual([]);
    expect(
      findSubsetOverlaps(
        { name: 'a', job: 'review migration', tools: ['Read'] },
        installed(['Read'], 'formats invoices'),
      ),
    ).toEqual([]);
  });
});
