import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TemplateEngine } from '@/templates/engine.js';
import { TemplateRegistry } from '@/templates/registry.js';

describe('runtime templates', () => {
  it('all templates render without errors', async () => {
    const registry = new TemplateRegistry(join(process.cwd(), 'runtime/templates'));
    const templates = await registry.discover();
    const engine = new TemplateEngine();

    for (const template of templates) {
      const output = await engine.render(template.path, {
        adapter: 'codex-cli',
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/rules',
        projectName: 'demo',
        moduleName: 'core',
        moduleSlug: 'core',
        commands: {
          test: 'pnpm test',
          lint: 'pnpm lint',
          format: 'pnpm format',
        },
        routing: {
          stack: 'laravel',
        },
        sections: [],
      });

      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    }
  });
});
