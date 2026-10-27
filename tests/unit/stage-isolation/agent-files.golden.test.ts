import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { renderClaudePluginStageAgents, writeStageAgents } from '@/stage-isolation/agent-writer';
import { MANDATORY_STAGE_AGENTS } from '@/stage-isolation/stage-agents';

const home = mkdtempSync(join(tmpdir(), 'paqad-agent-golden-'));
writeStageAgents({ homeDir: home });
afterAll(() => rmSync(home, { recursive: true, force: true }));

const CHANGED_FILES_SENTENCE =
  'If the entry gate blocks an edit, it names the files that changed. Read only those, write the marker it names, and retry.';

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
      expect(agent.content.replace(/\s+/g, ' ')).toContain(CHANGED_FILES_SENTENCE);
      expect(agent.content).not.toContain('per-agent marker under');
    }
  });
});
