import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  AGENT_HOST_TARGETS,
  parseAgentSource,
  renderAgentTemplate,
  renderProducedAgent,
} from '@/authoring/package/agent-render.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';

const SOURCE = `---
name: migration-reviewer
description: 'Use this agent when a change adds a database migration. For example "review this migration" or "is this migration safe".'
tools: Read, Grep, Glob
model: haiku
effort: low
maxTurns: 20
skills:
  - expert-notes
memory: project
isolation: worktree
permissionMode: bypassPermissions
experimental:
  cacheTtl: 1h
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node .claude/hooks/block-drop.mjs
---

## Objective

Review the migration "as given" with a \\ path.
`;

function tomlField(content: string, key: string): string | undefined {
  const line = content.split('\n').find((entry) => entry.startsWith(`${key} = `));
  return line === undefined ? undefined : (JSON.parse(line.slice(key.length + 3)) as string);
}

function tomlInstructions(content: string): string {
  const start = content.indexOf('developer_instructions = """\n');
  const body = content.slice(start + 'developer_instructions = """\n'.length);
  return body.slice(0, body.lastIndexOf('"""')).replaceAll('""\\"', '"""').replaceAll('\\\\', '\\');
}

describe('the host table', () => {
  it('is the one stage-agent host table, re-exported by the agent writer', () => {
    expect(STAGE_AGENT_HOSTS).toBe(AGENT_HOST_TARGETS);
    expect(AGENT_HOST_TARGETS.map((host) => host.adapter)).toEqual(['claude-code', 'codex-cli']);
  });

  it('renders the shipped stage-agent template with a context', () => {
    const out = renderAgentTemplate(AGENT_HOST_TARGETS[0]!, {
      agentName: 'x',
      description: 'd',
      model: 'inherit',
      tools: 'Read',
      body: 'B',
    });
    expect(out).toContain('name: x\n');
    expect(out).toContain('tools: Read\n');
  });
});

describe('parseAgentSource', () => {
  it('reads every supported frontmatter field and the body', () => {
    const source = parseAgentSource(SOURCE);
    expect(source).toMatchObject({
      name: 'migration-reviewer',
      tools: ['Read', 'Grep', 'Glob'],
      model: 'haiku',
      effort: 'low',
      maxTurns: 20,
      skills: ['expert-notes'],
      memory: 'project',
      isolation: 'worktree',
      cacheTtl: '1h',
      permissionMode: 'bypassPermissions',
    });
    expect(source.body.startsWith('## Objective')).toBe(true);
  });

  it('refuses a file with no frontmatter or no name', () => {
    expect(() => parseAgentSource('# no frontmatter')).toThrow(/no valid frontmatter/u);
    expect(() => parseAgentSource('---\ndescription: x\n---\nbody')).toThrow(/no name/u);
  });
});

describe('renderProducedAgent', () => {
  it('AC-17: writes no permissionMode without an approved packet and notes the omission', () => {
    const file = renderProducedAgent(parseAgentSource(SOURCE), 'claude-code');
    expect(file.path).toBe('.claude/agents/migration-reviewer.md');
    const split = splitSkillFrontmatter(file.content);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.data.permissionMode).toBeUndefined();
    expect(file.host_notes.join('\n')).toContain('permissionMode omitted');
    expect(split.data).toMatchObject({
      name: 'migration-reviewer',
      tools: 'Read, Grep, Glob',
      model: 'haiku',
      effort: 'low',
      maxTurns: 20,
      skills: ['expert-notes'],
      memory: 'project',
      isolation: 'worktree',
      experimental: { cacheTtl: '1h' },
    });
    expect(split.data.hooks).toEqual(YAML.parse(SOURCE.split('---')[1]!).hooks);
  });

  it('writes permissionMode only when the packet approved it', () => {
    const file = renderProducedAgent(parseAgentSource(SOURCE), 'claude-code', {
      permissionApproved: true,
    });
    const split = splitSkillFrontmatter(file.content);
    expect(split.ok && split.data.permissionMode).toBe('bypassPermissions');
    expect(file.host_notes).toEqual([]);
  });

  it('omits fields the source does not set', () => {
    const file = renderProducedAgent(
      parseAgentSource('---\nname: db-reader\ndescription: d\n---\nBody\n'),
      'claude-code',
    );
    expect(file.content).toBe('---\nname: db-reader\ndescription: d\n---\n\nBody\n');
  });

  it('AC-14: writes Codex TOML with documented fields only and notes every omission', () => {
    const source = parseAgentSource(SOURCE);
    const file = renderProducedAgent(source, 'codex-cli');
    expect(file.path).toBe('.codex/agents/migration-reviewer.toml');
    expect(tomlField(file.content, 'name')).toBe('migration-reviewer');
    expect(tomlField(file.content, 'model')).toBe('haiku');
    expect(tomlField(file.content, 'model_reasoning_effort')).toBe('low');
    expect(tomlInstructions(file.content)).toBe(source.body);
    expect(file.content).not.toContain('maxTurns');
    expect(file.host_notes).toEqual([
      'tools omitted: Codex has no documented field for it',
      'maxTurns omitted: Codex has no documented field for it',
      'skills omitted: Codex has no documented field for it',
      'memory omitted: Codex has no documented field for it',
      'isolation omitted: Codex has no documented field for it',
      'hooks omitted: Codex has no documented field for it',
      'cacheTtl omitted: Codex has no documented field for it',
      'permissionMode omitted: Codex has no documented field for it',
    ]);
  });

  it('refuses a host with no agent support', () => {
    expect(() => renderProducedAgent(parseAgentSource(SOURCE), 'cursor')).toThrow(
      /no agent host configured for "cursor"/u,
    );
  });
});
