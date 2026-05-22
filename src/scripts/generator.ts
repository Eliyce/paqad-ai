import { chmodSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { buildRunnerScriptContext } from '@/templates/context-builders/runner-scripts.js';
import { TemplateEngine } from '@/templates/engine.js';
import { TemplateRegistry } from '@/templates/registry.js';

export class RunnerScriptGenerator {
  private readonly engine = new TemplateEngine();

  async generate(profile: ProjectProfile): Promise<GeneratedFile[]> {
    const registry = new TemplateRegistry(join(getRuntimeTemplatesRoot(), 'runner-scripts'));
    const templates = await registry.discover();

    return Promise.all(
      templates.map(async (template) => ({
        path: join('scripts', template.relativePath.replace(/\.hbs$/, '')),
        content: await this.engine.render(template.path, buildScriptContext(profile)),
        autoUpdate: true,
        executable: true,
      })),
    );
  }

  async write(projectRoot: string, profile: ProjectProfile): Promise<string[]> {
    const generated = await this.generate(profile);
    const written: string[] = [];

    for (const file of generated) {
      const target = join(projectRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
      chmodSync(target, 0o755);
      written.push(file.path);
    }

    return written;
  }
}

function buildScriptContext(profile: ProjectProfile): Record<string, unknown> {
  return buildRunnerScriptContext({
    projectName: profile.project.name,
    commands: {
      test: profile.commands.test,
      lint: profile.commands.lint,
      format: profile.commands.format,
    },
    stack: getPrimaryStack(profile),
  });
}
