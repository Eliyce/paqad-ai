import { ContinueAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

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
    // Issue #229 — the entry file is now a lean stub: a one-line bootstrap
    // pointer plus the graceful-degradation fallback clause and the footer.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain('Adapter:');
    expect(content).toContain('Do not block.');
    // The load steps and contracts moved to the bootstrap; nothing inlined here.
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
