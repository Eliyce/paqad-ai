import { GithubCopilotAdapter } from '@/adapters';

describe('GithubCopilotAdapter', () => {
  const adapter = new GithubCopilotAdapter();

  it('generates a lean .github/copilot-instructions.md stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('.github/copilot-instructions.md');
    expect(files[0]?.content).toContain('.paqad/framework-path.txt');
    expect(files[0]?.content).toContain('AGENT-BOOTSTRAP.md');
    expect(files[0]?.content).toContain('Adapter:');
    expect(files[0]?.content).not.toContain('docs/instructions');
    expect(files[0]?.content).not.toContain('create documentation');
    expect(files[0]?.content).not.toContain('## ');
  });

  it('writes no MCP config at .vscode/mcp.json (issue #622)', async () => {
    expect(await adapter.installMcp()).toEqual([]);
  });

  it('supports only config generation and MCP — no skills, agents, hooks, caching, or memory', () => {
    expect(adapter.capabilities).toEqual({
      skills: false,
      agents: false,
      hooks: false,
      mcp: true,
      caching: false,
      memory: false,
    });
  });
});
