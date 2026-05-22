import { AntigravityAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('AntigravityAdapter', () => {
  const adapter = new AntigravityAdapter();

  it('generates ANTIGRAVITY.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('ANTIGRAVITY.md');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in the Antigravity directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.antigravity/skills/sample-skill/SKILL.md',
      '.antigravity/skills/sample-skill/agents/openai.yaml',
      '.antigravity/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes MCP config to .antigravity/mcp.json', async () => {
    const files = await adapter.installMcp([], fixtureProfile('laravel'));
    expect(files[0]?.path).toBe('.antigravity/mcp.json');
  });
});
