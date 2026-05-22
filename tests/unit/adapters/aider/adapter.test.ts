import { AiderAdapter } from '@/adapters';

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter();

  it('generates CONVENTIONS.md', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('CONVENTIONS.md');
    expect(files[0]?.content).toContain('docs/instructions/stack');
    expect(files[0]?.content).toContain('docs/instructions/rules');
  });

  it('generates only CONVENTIONS.md with no sidecar files', async () => {
    const configFiles = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(configFiles).toHaveLength(1);
  });

  it('supports config generation only — no skills, agents, hooks, mcp, caching, or memory', () => {
    expect(adapter.capabilities).toEqual({
      skills: false,
      agents: false,
      hooks: false,
      mcp: false,
      caching: false,
      memory: false,
    });
  });
});
