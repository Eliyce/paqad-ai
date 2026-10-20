import { AiderAdapter } from '@/adapters';

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter();

  it('generates a lean CONVENTIONS.md bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    const content = files[0]?.content ?? '';
    expect(files[0]?.path).toBe('CONVENTIONS.md');
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain('Do not block.');
    expect(content).toContain('Adapter:');
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## ');
  });

  it('generates CONVENTIONS.md plus the attribution config and nothing else', async () => {
    const configFiles = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(configFiles.map((file) => file.path)).toEqual(['CONVENTIONS.md', '.aider.conf.yml']);
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
