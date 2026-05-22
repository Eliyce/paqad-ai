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
  ])('%s stays under 80 lines and references framework path', async (file) => {
    const output = await engine.render(
      join(process.cwd(), 'runtime/templates/agent-configs', file),
      context,
    );

    expect(output.split('\n').length).toBeLessThan(80);
    expect(output).toContain('.paqad/framework-path.txt');
    expect(output).toContain('create documentation');
    expect(output).toContain('Do not ask the user to choose a document type');
    expect(output.includes(process.cwd())).toBe(false);
  });
});
