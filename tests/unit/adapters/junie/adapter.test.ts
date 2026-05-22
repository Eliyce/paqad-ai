import { JunieAdapter } from '@/adapters';

describe('JunieAdapter', () => {
  const adapter = new JunieAdapter();

  it('generates .junie/AGENTS.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });

    expect(files[0]?.path).toBe('.junie/AGENTS.md');
    expect(files[0]?.content).toContain('.paqad/framework-path.txt');
    expect(files[0]?.content).toContain('docs/instructions/rules');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).not.toContain('*** End Patch');
    expect(files[0]?.content).not.toContain('functions.apply_patch');
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
