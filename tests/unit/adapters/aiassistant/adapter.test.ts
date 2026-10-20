import { AiAssistantAdapter } from '@/adapters';

describe('AiAssistantAdapter', () => {
  const adapter = new AiAssistantAdapter();

  it('generates .aiassistant/rules/guidelines.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });

    const content = files[0]?.content ?? '';

    expect(files[0]?.path).toBe('.aiassistant/rules/guidelines.md');

    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toMatch(/Adapter:\s*\naiassistant/);

    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## paqad in your chat');
    expect(content).not.toContain('## Decision Pause Contract');
    expect(content).not.toMatch(/^## /m);
  });

  it('is a soft, rules-only adapter with no sidecar capabilities', () => {
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
