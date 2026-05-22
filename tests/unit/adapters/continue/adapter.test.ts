import { ContinueAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('ContinueAdapter', () => {
  const adapter = new ContinueAdapter();

  it('generates .continue/rules/paqad.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.continue/rules/paqad.md');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in .continue/prompts', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.continue/prompts/sample-skill/SKILL.md',
      '.continue/prompts/sample-skill/agents/openai.yaml',
      '.continue/prompts/sample-skill/references/checklist.md',
    ]);
  });

  it('writes mcp config to .continue/mcp.json', async () => {
    const files = await adapter.installMcp([], fixtureProfile('laravel'));
    expect(files[0]?.path).toBe('.continue/mcp.json');
  });

  it('supports skills and mcp but not agents, hooks, caching, or memory', () => {
    expect(adapter.capabilities).toEqual({
      skills: true,
      agents: false,
      hooks: false,
      mcp: true,
      caching: false,
      memory: false,
    });
  });
});
