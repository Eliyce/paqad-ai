import { GithubCopilotAdapter } from '@/adapters';

import { fixtureProfile } from '../shared.fixture';

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

  it('writes mcp config to .vscode/mcp.json', async () => {
    const files = await adapter.installMcp([], fixtureProfile('laravel'));
    expect(files[0]?.path).toBe('.vscode/mcp.json');
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
