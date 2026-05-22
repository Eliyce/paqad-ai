import { join } from 'node:path';

import { TemplateEngine } from '@/templates';

describe('TemplateEngine', () => {
  const engine = new TemplateEngine();

  it('renders a simple template with context', async () => {
    const output = await engine.render(
      join(process.cwd(), 'runtime/templates/spec-document.md.hbs'),
      {
        story: 'Story',
        acceptanceCriteria: 'Given x When y Then z',
        testPlan: 'Tests',
      },
    );

    expect(output).toContain('## User Story');
    expect(output).toContain('Story');
  });

  it('handles missing optional context gracefully', async () => {
    const output = await engine.render(
      join(process.cwd(), 'runtime/templates/registry-file.md.hbs'),
      { name: 'module-registry' },
    );
    expect(output).toContain('module-registry');
  });

  it('custom helpers work', async () => {
    const output = await engine.render(
      join(process.cwd(), 'tests/unit/templates/fixtures/helper.hbs'),
      { value: 'Hello World', tags: ['a', 'b'] },
    );

    expect(output).toContain('hello-world');
    expect(output).toContain('A, B');
  });

  it('if_eq helper selects the matching branch', async () => {
    const output = await engine.render(
      join(process.cwd(), 'tests/unit/templates/fixtures/if-eq.hbs'),
      { left: 'same', right: 'same' },
    );

    expect(output.trim()).toBe('match');
  });
});
