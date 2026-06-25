import { GeminiCliAdapter } from '@/adapters';

import { fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();

  it('generates a lean GEMINI.md stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('GEMINI.md');
    expect(files[0]?.content).toContain('.paqad/framework-path.txt');
    expect(files[0]?.content).toContain('AGENT-BOOTSTRAP.md');
    expect(files[0]?.content).toContain('Adapter:');
    expect(files[0]?.content).not.toContain('docs/instructions');
    expect(files[0]?.content).not.toContain('create documentation');
    expect(files[0]?.content).not.toContain('## ');
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
