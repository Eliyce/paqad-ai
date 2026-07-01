import { join } from 'node:path';

import { TemplateEngine } from '@/templates';

describe('agent config templates', () => {
  const engine = new TemplateEngine();
  const context = {
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/rules',
    adapter: 'claude-code',
  };

  it.each([
    'claude.md.hbs',
    'agents.md.hbs',
    'antigravity.md.hbs',
    'gemini.md.hbs',
    'continue.md.hbs',
    'copilot.md.hbs',
    'cursor.md.hbs',
    'junie.md.hbs',
    'windsurf.md.hbs',
    'aider.md.hbs',
    'aiassistant.md.hbs',
  ])('%s is a lean stub that points to the framework bootstrap', async (file) => {
    const output = await engine.render(
      join(process.cwd(), 'runtime/templates/agent-configs', file),
      context,
    );

    // Lean stub (issue #229): a bootstrap pointer + the Adapter footer, nothing more.
    expect(output.split('\n').length).toBeLessThan(80);
    expect(output).toContain('.paqad/framework-path.txt');
    expect(output).toContain('AGENT-BOOTSTRAP.md');
    expect(output).toContain('Adapter:');
    // The load order and the workflow-handling prose moved into the bootstrap, so
    // the always-injected entry file must name neither.
    expect(output).not.toContain('docs/instructions');
    expect(output).not.toContain('docs/modules');
    expect(output).not.toContain('create documentation');
    // No `##` sections, and neither contract is inlined.
    expect(output).not.toContain('## ');
    expect(output).not.toContain('Decision Pause Contract');
    expect(output).not.toContain('narration contract');
    expect(output.includes(process.cwd())).toBe(false);
  });
});
