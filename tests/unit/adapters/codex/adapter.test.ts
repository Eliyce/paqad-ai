import { CodexCliAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('CodexCliAdapter', () => {
  const adapter = new CodexCliAdapter();

  it('generates AGENTS.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('AGENTS.md');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in the Codex directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.codex/skills/sample-skill/SKILL.md',
      '.codex/skills/sample-skill/agents/openai.yaml',
      '.codex/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes Dart MCP config for flutter', async () => {
    const files = await adapter.installMcp([], fixtureProfile('flutter'));
    expect(files[0]?.content).toContain('dart-mcp');
  });
});
