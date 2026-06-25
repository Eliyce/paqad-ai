import { CodexCliAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('CodexCliAdapter', () => {
  const adapter = new CodexCliAdapter();

  it('generates AGENTS.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('AGENTS.md');
    const content = files[0]?.content ?? '';

    // Issue #229 — the entry file is now a lean stub: a one-line bootstrap pointer
    // (mentioning `.paqad/framework-path.txt` + `AGENT-BOOTSTRAP.md`), the
    // graceful-degradation fallback clause, and the `Adapter:` footer.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toContain('Adapter:');
    expect(content).toContain('codex-cli');

    // The stub carries ZERO `## ` headings and no longer inlines load steps,
    // instruction-doc paths, the documentation workflow prose, or either contract.
    expect(content).not.toMatch(/^## /m);
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('Do not ask the user to choose a document type');
    expect(content).not.toContain('paqad in your chat');
    expect(content).not.toContain('Decision Pause Contract');
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
