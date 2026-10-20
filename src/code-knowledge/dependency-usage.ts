import { extractImportSpecifiers } from '@/graph/import-scanner.js';
import { createDefaultEcosystemParserRegistry } from '@/introspection/ecosystems/registry.js';

import type { CodeKnowledgeDependency } from './types.js';

const TS_JS_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

export function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  if (specifier.startsWith('@/')) {
    return null;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

export async function computeDependencyUsage(
  projectRoot: string,
  files: string[],
  contentByFile: Map<string, string>,
): Promise<CodeKnowledgeDependency[]> {
  const importedPackages = new Set<string>();
  for (const file of files) {
    if (!TS_JS_EXTENSION_RE.test(file)) continue;
    const content = contentByFile.get(file);
    if (content === undefined) continue;
    for (const specifier of extractImportSpecifiers(content)) {
      const name = packageNameFromSpecifier(specifier);
      if (name !== null) {
        importedPackages.add(name);
      }
    }
  }

  const parsed = await createDefaultEcosystemParserRegistry().parseProject(projectRoot);
  const dependencies: CodeKnowledgeDependency[] = [];
  const seen = new Set<string>();
  for (const result of parsed) {
    for (const pkg of result.packages) {
      if (pkg.ecosystem !== 'node' || seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      dependencies.push({
        name: pkg.name,
        ecosystem: pkg.ecosystem,
        imported: importedPackages.has(pkg.name),
      });
    }
  }
  return dependencies.sort((a, b) => a.name.localeCompare(b.name));
}
