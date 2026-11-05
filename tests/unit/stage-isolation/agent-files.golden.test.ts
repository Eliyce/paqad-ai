import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { renderClaudePluginStageAgents, writeStageAgents } from '@/stage-isolation/agent-writer';
import {
  AGENT_ENTRY_MARKER_FALLBACK,
  MANDATORY_STAGE_AGENTS,
} from '@/stage-isolation/stage-agents';

const home = mkdtempSync(join(tmpdir(), 'paqad-agent-golden-'));
writeStageAgents({ homeDir: home });
afterAll(() => rmSync(home, { recursive: true, force: true }));

function filesIn(subdir: string): string[] {
  return readdirSync(join(home, subdir)).sort();
}

const STAGE_HELPER_FILES = new Set(MANDATORY_STAGE_AGENTS.map((def) => `${def.agentName}.md`));
const pluginStageAgents = renderClaudePluginStageAgents().filter((agent) =>
  STAGE_HELPER_FILES.has(agent.name),
);

describe('rendered agent files', () => {
  it.each(filesIn('.codex/agents'))('codex-cli %s', (name) => {
    expect(readFileSync(join(home, '.codex/agents', name), 'utf8')).toMatchSnapshot();
  });

  it.each(['paqad-expert.md', 'paqad-chief-architect.md'])('claude-code High Table %s', (name) => {
    expect(readFileSync(join(home, '.claude/agents', name), 'utf8')).toMatchSnapshot();
  });

  it.each(pluginStageAgents.map((agent) => agent.name))('claude-code stage helper %s', (name) => {
    const agent = pluginStageAgents.find((candidate) => candidate.name === name);
    expect(agent?.content).toMatchSnapshot();
  });

  it('AC-53: all six stage helpers carry the changed-files entry gate text', () => {
    expect(pluginStageAgents).toHaveLength(6);
    for (const agent of pluginStageAgents) {
      expect(agent.content.replace(/\s+/g, ' ')).toContain(AGENT_ENTRY_MARKER_FALLBACK.join(' '));
      expect(agent.content).not.toContain('per-agent marker under');
    }
  });
});
