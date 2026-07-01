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

    // AI Assistant auto-applies every `*.md` under `.aiassistant/rules/`; paqad
    // owns a dedicated file rather than a hooks sidecar (issue #219).
    expect(files[0]?.path).toBe('.aiassistant/rules/guidelines.md');

    // Issue #229 — the entry file is a lean stub: a one-line pointer to the
    // framework bootstrap, the graceful-degradation fallback clause, and the
    // `Adapter:` footer. Nothing else.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toMatch(/Adapter:\s*\naiassistant/);

    // The load order, workflow-handling prose, and both contracts now live in
    // the bootstrap — never inlined into the entry file.
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## paqad in your chat');
    expect(content).not.toContain('## Decision Pause Contract');
    // A lean stub carries zero `## ` headings.
    expect(content).not.toMatch(/^## /m);
  });

  it('is a soft, rules-only adapter with no sidecar capabilities', () => {
    // JetBrains AI Assistant has no hook/lifecycle system, so the sentinel gate
    // cannot bind — advisory only. MCP is configured in the IDE, not a project
    // file, so no MCP artifact is emitted (modeled on aider).
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
