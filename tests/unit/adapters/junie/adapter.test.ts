import { JunieAdapter } from '@/adapters';

describe('JunieAdapter', () => {
  const adapter = new JunieAdapter();

  it('generates .junie/AGENTS.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });

    const content = files[0]?.content ?? '';

    expect(files[0]?.path).toBe('.junie/AGENTS.md');

    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toMatch(/Adapter:\s*\njunie/);

    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## paqad in your chat');
    expect(content).not.toContain('## Decision Pause Contract');
    expect(content).not.toMatch(/^## /m);

    expect(content).not.toContain('*** End Patch');
    expect(content).not.toContain('functions.apply_patch');
  });

  it('supports only config and MCP sidecars', () => {
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
