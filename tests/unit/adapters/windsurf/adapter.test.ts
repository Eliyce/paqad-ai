import { WindsurfAdapter } from '@/adapters';

import { fixtureArtifact, fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('WindsurfAdapter', () => {
  const adapter = new WindsurfAdapter();

  it('generates .windsurfrules as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    const content = files[0]?.content ?? '';
    expect(files[0]?.path).toBe('.windsurfrules');

    // Lean stub: a bootstrap pointer + the graceful-degradation fallback clause
    // + the `Adapter:` footer, with zero `##` sections (issue #229). The load
    // order and both contracts now live only in the framework bootstrap.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain('proceed as a normal assistant');
    expect(content).toContain('Do not block');
    expect(content).toContain('Adapter:');
    expect(content.split('\n').filter((line) => line.startsWith('## '))).toEqual([]);

    // No load steps, no docs paths, no inlined contracts.
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('Decision Pause Contract');
    expect(content).not.toContain('narration contract');
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
