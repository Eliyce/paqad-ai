import { AntigravityAdapter } from '@/adapters';

import { fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('AntigravityAdapter', () => {
  const adapter = new AntigravityAdapter();

  it('generates ANTIGRAVITY.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    const content = files[0]?.content ?? '';
    expect(files[0]?.path).toBe('ANTIGRAVITY.md');

    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain('proceed as a normal assistant');
    expect(content).toContain('Do not block');
    expect(content).toContain('Adapter:');

    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('Decision Pause Contract');
    expect(content).not.toContain('paqad in your chat');
    expect(content).not.toMatch(/^## /m);
  });

  it('places skills in the Antigravity directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.antigravity/skills/sample-skill/SKILL.md',
      '.antigravity/skills/sample-skill/agents/openai.yaml',
      '.antigravity/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes no MCP config at .antigravity/mcp.json', async () => {
    expect(await adapter.installMcp()).toEqual([]);
  });
});
