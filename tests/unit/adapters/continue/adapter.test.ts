import { ContinueAdapter } from '@/adapters';

import { fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('ContinueAdapter', () => {
  const adapter = new ContinueAdapter();

  it('generates .continue/rules/paqad.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.continue/rules/paqad.md');
    const content = files[0]?.content ?? '';
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain('Adapter:');
    expect(content).toContain('Do not block.');
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## ');
  });

  it('places skills in .continue/prompts', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.continue/prompts/sample-skill/SKILL.md',
      '.continue/prompts/sample-skill/agents/openai.yaml',
      '.continue/prompts/sample-skill/references/checklist.md',
    ]);
  });

  it('writes no MCP config at .continue/mcp.json', async () => {
    expect(await adapter.installMcp()).toEqual([]);
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
