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

    // Issue #229 — the entry file is now a lean stub: a one-line pointer to the
    // framework bootstrap, the graceful-degradation fallback clause, and the
    // `Adapter:` footer. Nothing else.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toMatch(/Adapter:\s*\njunie/);

    // The load order, workflow-handling prose, and both contracts now live in
    // the bootstrap — never inlined into the entry file.
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('## paqad in your chat');
    expect(content).not.toContain('## Decision Pause Contract');
    // A lean stub carries zero `## ` headings.
    expect(content).not.toMatch(/^## /m);

    // Junie's onboarding prose is plain Markdown, never an apply-patch envelope.
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
