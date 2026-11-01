import { describe, expect, it } from 'vitest';

import {
  PAQAD_REPO_AGENT_ROOTS,
  agentNameOf,
  agentRoots,
  findAgentPaths,
  isAgentPath,
} from '@/authoring/paths.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';

const ALL: readonly AdapterType[] = ADAPTER_TYPES;
const NON_SUBAGENT_HOSTS = ALL.filter(
  (type) => !STAGE_AGENT_HOSTS.some((host) => host.adapter === type),
);

describe('agentRoots', () => {
  it('takes only hosts that run subagents, from their adapters', () => {
    expect(agentRoots(ALL)).toEqual(['.claude/agents', '.codex/agents']);
    expect(agentRoots(['cursor', 'gemini-cli'])).toEqual([]);
  });

  it('adds the paqad runtime agent roots only in the paqad repo', () => {
    expect(agentRoots(['claude-code'], { paqadRepo: true })).toEqual([
      '.claude/agents',
      ...PAQAD_REPO_AGENT_ROOTS,
    ]);
    expect(agentRoots(['claude-code'])).toEqual(['.claude/agents']);
  });
});

describe('isAgentPath and agentNameOf', () => {
  it('names a direct child file of a host agents folder by its stem', () => {
    expect(agentNameOf('.claude/agents/migration-reviewer.md', ALL)).toBe('migration-reviewer');
    expect(agentNameOf('./.codex/agents/db-reader.toml', ALL)).toBe('db-reader');
    expect(agentNameOf('.claude\\agents\\code-reviewer.md', ALL)).toBe('code-reviewer');
  });

  it('ignores nested files, the folder itself and hidden files', () => {
    expect(isAgentPath('.claude/agents/nested/x.md', ALL)).toBe(false);
    expect(isAgentPath('.claude/agents', ALL)).toBe(false);
    expect(isAgentPath('.claude/agents/.keep', ALL)).toBe(false);
    expect(isAgentPath('src/agents/x.md', ALL)).toBe(false);
  });

  it('AC-34: files under the agents folder of a host that runs no subagents are not agent paths', () => {
    for (const type of NON_SUBAGENT_HOSTS) {
      expect(agentRoots([type])).toEqual([]);
    }
    expect(isAgentPath('.cursor/agents/helper.md', ALL)).toBe(false);
    expect(isAgentPath('.gemini/agents/helper.md', ALL)).toBe(false);
    expect(isAgentPath('.github/agents/helper.md', ALL)).toBe(false);
  });

  it('a host that is not enabled gives no agent path', () => {
    expect(isAgentPath('.codex/agents/db-reader.toml', ['claude-code'])).toBe(false);
  });

  it('matches the paqad runtime agent roots in the paqad repo, including the stage-agent templates', () => {
    const repo = { paqadRepo: true };
    expect(agentNameOf('runtime/base/agents/agent-orchestrator.md', ALL, repo)).toBe(
      'agent-orchestrator',
    );
    expect(agentNameOf('runtime/claude-plugin/agents/paqad-review.md', ALL, repo)).toBe(
      'paqad-review',
    );
    expect(agentNameOf('runtime/capabilities/security/agents/auditor.md', ALL, repo)).toBe(
      'auditor',
    );
    expect(agentNameOf('runtime/templates/stage-agents/claude.md.hbs', ALL, repo)).toBe('claude');
    expect(isAgentPath('runtime/base/agents/agent-orchestrator.md', ALL)).toBe(false);
  });
});

describe('findAgentPaths', () => {
  it('keeps only agent paths', () => {
    expect(
      findAgentPaths(
        [
          'src/a.ts',
          '.claude/agents/migration-reviewer.md',
          '.cursor/agents/x.md',
          '.claude/skills/foo/SKILL.md',
          '.codex/agents/db-reader.toml',
        ],
        ALL,
      ),
    ).toEqual(['.claude/agents/migration-reviewer.md', '.codex/agents/db-reader.toml']);
  });
});
