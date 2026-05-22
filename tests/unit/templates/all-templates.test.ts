import { join } from 'node:path';

import { TemplateEngine } from '@/templates/engine.js';
import { TemplateRegistry } from '@/templates/registry.js';

describe('template registry sweep', () => {
  it('renders every runtime template', async () => {
    const root = join(process.cwd(), 'runtime/templates');
    const registry = new TemplateRegistry(root);
    const engine = new TemplateEngine();
    const templates = await registry.discover();

    const context = {
      adapter: 'claude-code',
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/rules',
      projectName: 'Demo',
      commands: {
        install: 'pnpm install',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test -- one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'pnpm migrate',
        build: 'pnpm build',
      },
      routing: {
        stack: 'laravel',
      },
      moduleName: 'billing',
      moduleSlug: 'billing',
      title: 'Billing',
      summary: 'Summary',
    };

    const rendered = await Promise.all(
      templates.map((template) => engine.render(template.path, context)),
    );

    expect(rendered).toHaveLength(templates.length);
    expect(rendered.every((output) => output.trim().length > 0)).toBe(true);
  });
});
