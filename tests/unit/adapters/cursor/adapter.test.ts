import { CursorAdapter } from '@/adapters';

import { fixtureArtifact, fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('generates .cursor/rules/paqad.mdc', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.cursor/rules/paqad.mdc');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in the Cursor directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.cursor/skills/sample-skill/SKILL.md',
      '.cursor/skills/sample-skill/agents/openai.yaml',
      '.cursor/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes mcp config to .cursor/mcp.json', async () => {
    const files = await adapter.installMcp([], fixtureProfile('laravel'));
    expect(files[0]?.path).toBe('.cursor/mcp.json');
  });

  it('supports skills, agents, mcp, caching, and memory but not hooks', () => {
    expect(adapter.capabilities).toEqual({
      skills: true,
      agents: true,
      hooks: false,
      mcp: true,
      caching: true,
      memory: true,
    });
  });

  it('writes agents to .cursor/agents', async () => {
    const files = await adapter.generateAgents([fixtureArtifact('sample-agent.md')]);
    expect(files[0]?.path).toBe('.cursor/agents/sample-agent.md');
  });
});
