import { CursorAdapter } from '@/adapters';

import { fixtureArtifact, fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('generates .cursor/rules/paqad.mdc as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.cursor/rules/paqad.mdc');
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
