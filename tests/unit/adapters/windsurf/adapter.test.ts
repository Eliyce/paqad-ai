import { WindsurfAdapter } from '@/adapters';

import { fixtureArtifact, fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('WindsurfAdapter', () => {
  const adapter = new WindsurfAdapter();

  it('generates .windsurfrules', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.windsurfrules');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in the Windsurf directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.windsurf/skills/sample-skill/SKILL.md',
      '.windsurf/skills/sample-skill/agents/openai.yaml',
      '.windsurf/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes mcp config to .windsurf/mcp.json', async () => {
    const files = await adapter.installMcp([], fixtureProfile('laravel'));
    expect(files[0]?.path).toBe('.windsurf/mcp.json');
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

  it('writes agents to .windsurf/agents', async () => {
    const files = await adapter.generateAgents([fixtureArtifact('sample-agent.md')]);
    expect(files[0]?.path).toBe('.windsurf/agents/sample-agent.md');
  });
});
