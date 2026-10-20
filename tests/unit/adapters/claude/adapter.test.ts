import { ClaudeCodeAdapter } from '@/adapters';

import { fixtureArtifact, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  it('generates CLAUDE.md under 80 lines', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('CLAUDE.md');
    expect(files[0]?.content.split('\n').length).toBeLessThan(80);
    expect(files[0]?.content).toContain('.paqad/framework-path.txt');
    expect(files[0]?.content).toContain('AGENT-BOOTSTRAP.md');
    expect(files[0]?.content).toContain('Adapter:');
    expect(files[0]?.content).not.toContain('docs/instructions');
    expect(files[0]?.content).not.toContain('create documentation');
  });

  it('places skills in the Claude directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.claude/skills/sample-skill/SKILL.md',
      '.claude/skills/sample-skill/agents/openai.yaml',
      '.claude/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes no MCP config at a Claude Code path', async () => {
    expect(await adapter.installMcp()).toEqual([]);
  });

  it('reads MCP servers from the project .mcp.json Claude Code uses', () => {
    expect(adapter.getMcpPath()).toBe('.mcp.json');
  });

  it('writes hook registration output', async () => {
    const files = await adapter.installHooks([fixtureArtifact('sample-agent.md')]);
    expect(files[0]?.path).toBe('.claude/settings.hooks.json');
  });

  it('does not leak absolute paths into the hooks manifest', async () => {
    const files = await adapter.installHooks([fixtureArtifact('sample-agent.md')]);
    const content = files[0]?.content ?? '';
    const parsed = JSON.parse(content);
    expect(parsed).toEqual([{ source: 'sample-agent.md' }]);
    expect(content).not.toMatch(/\/Users\/|\/home\/|\/opt\/|_npx\/|[A-Z]:\\\\/);
  });
});
