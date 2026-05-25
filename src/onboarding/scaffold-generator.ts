import { join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { buildModuleScaffoldContext } from '@/templates/index.js';
import { TemplateEngine } from '@/templates/engine.js';

const FEATURE_TEMPLATE_TARGETS = [
  ['business.md.hbs', toPosixPath(join(PATHS.MODULE_FEATURES_DIR, 'core', 'business.md'))],
  ['technical.md.hbs', toPosixPath(join(PATHS.MODULE_FEATURES_DIR, 'core', 'technical.md'))],
] as const;

const MODULE_TEMPLATE_TARGETS = [
  ['summary.md.hbs', 'index/summary.md'],
  ['schema.md.hbs', 'database/schema.md'],
  ['indexes.md.hbs', 'database/indexes.md'],
  ['queries.md.hbs', 'database/queries.md'],
  ['data-volumes.md.hbs', 'database/data-volumes.md'],
  ['api-endpoints.md.hbs', 'api/endpoints.md'],
  ['api-schemas.md.hbs', 'api/schemas.md'],
  ['api-error-codes.md.hbs', 'api/error-codes.md'],
  ['integration-events.md.hbs', 'integration/events.md'],
  ['integration-contracts.md.hbs', 'integration/contracts.md'],
  ['error-catalog.md.hbs', 'error-catalog.md'],
  ['screens.md.hbs', 'ui/screens.md'],
  ['components.md.hbs', 'ui/components.md'],
  ['states.md.hbs', 'ui/states.md'],
] as const;

export async function generateDocumentationScaffold(
  moduleNames: string[] = ['core'],
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];

  for (const moduleName of Array.from(new Set(moduleNames)).sort()) {
    files.push(...(await generateModuleScaffold(moduleName)));
  }

  return files;
}

export async function generateModuleScaffold(moduleName: string): Promise<GeneratedFile[]> {
  const engine = new TemplateEngine();
  const context = buildModuleScaffoldContext(moduleName);
  const files: GeneratedFile[] = [];

  for (const [templateName, relativeTarget] of FEATURE_TEMPLATE_TARGETS) {
    files.push({
      path: toPosixPath(join(PATHS.MODULES_DIR, moduleName, relativeTarget)),
      content: await engine.render(
        join(getRuntimeTemplatesRoot(), 'module-scaffold', templateName),
        context,
      ),
      autoUpdate: false,
    });
  }

  for (const [templateName, relativeTarget] of MODULE_TEMPLATE_TARGETS) {
    files.push({
      path: toPosixPath(join(PATHS.MODULES_DIR, moduleName, relativeTarget)),
      content: await engine.render(
        join(getRuntimeTemplatesRoot(), 'module-scaffold', templateName),
        context,
      ),
      autoUpdate: false,
    });
  }

  return files;
}
