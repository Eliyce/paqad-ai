import { REGISTRIES } from '@/core/constants/paths.js';

const FILE_REGISTRY_RULES: Array<{ patterns: RegExp[]; registries: string[] }> = [
  {
    patterns: [/^app\/Models\//, /^lib\/models\//],
    registries: ['model-registry.md', 'table-registry.md'],
  },
  {
    patterns: [/^routes\//, /^lib\/router\//, /^app\/Http\/Controllers\//],
    registries: ['api-registry.md'],
  },
  { patterns: [/^database\/migrations\//], registries: ['table-registry.md', 'query-registry.md'] },
  { patterns: [/^src\/components\//, /^lib\/widgets\//], registries: ['component-registry.md'] },
  { patterns: [/^resources\/views\//, /^lib\/screens\//], registries: ['screen-registry.md'] },
  {
    patterns: [/^app\/Events\//, /^app\/Listeners\//, /^app\/Jobs\//],
    registries: ['job-event-registry.md', 'integration-registry.md'],
  },
  { patterns: [/^app\/Exceptions\//], registries: ['error-code-registry.md'] },
  { patterns: [/^tests\//], registries: ['test-registry.md'] },
];

export class FileRegistryMapper {
  getAffectedRegistries(file: string): string[] {
    const affected = new Set<string>();

    for (const rule of FILE_REGISTRY_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(file))) {
        rule.registries.forEach((registry) => affected.add(registry));
      }
    }

    if (isModuleDirectory(file)) {
      affected.add('module-registry.md');
      affected.add('feature-registry.md');
    }

    return REGISTRIES.filter((registry) => affected.has(registry));
  }
}

function isModuleDirectory(file: string): boolean {
  return /(^|\/)modules\/[^/]+/.test(file) || /^docs\/modules\/[^/]+/.test(file);
}
