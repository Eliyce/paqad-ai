import { join } from 'node:path';

import { TemplateEngine, TemplateRegistry } from '@/templates';

describe('runner script templates', () => {
  it('renders all runner scripts as bash snippets', async () => {
    const engine = new TemplateEngine();
    const registry = new TemplateRegistry(join(process.cwd(), 'runtime/templates/runner-scripts'));
    const templates = await registry.discover();

    const outputs = await Promise.all(
      templates.map((template) =>
        engine.render(template.path, {
          projectName: 'demo-project',
          commands: {
            test: 'pnpm test',
            lint: 'pnpm lint',
            format: 'pnpm format',
          },
          routing: {
            stack: 'laravel',
          },
        }),
      ),
    );

    for (const output of outputs) {
      expect(output.startsWith('#!/usr/bin/env bash')).toBe(true);
    }
  });
});
