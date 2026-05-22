import { GeminiCliAdapter } from '@/adapters';

import { fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();

  it('generates GEMINI.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('GEMINI.md');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('places skills in the Gemini directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.gemini/skills/sample-skill/SKILL.md',
      '.gemini/skills/sample-skill/agents/openai.yaml',
      '.gemini/skills/sample-skill/references/checklist.md',
    ]);
  });
});
