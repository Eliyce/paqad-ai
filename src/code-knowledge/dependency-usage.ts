// Dependency-usage derivation for the code-knowledge index (issue #353). For each
// declared dependency, is it actually imported anywhere? That answers "declared but
// never imported" (AC-3) — the unused-dependency half of the dead-code story.
//
// v1 scope is the node ecosystem, the only one whose imports this index can scan
// (via the TS/JS import scanner). Other ecosystems' manifests parse fine but their
// import syntax is not scanned yet, so claiming `imported: false` for them would be
// dishonest; they are omitted rather than mislabelled. The extraction seam can add
// PHP `use` / Python `import` scanning later without changing the index shape.

import { extractImportSpecifiers } from '@/graph/import-scanner.js';
import { createDefaultEcosystemParserRegistry } from '@/introspection/ecosystems/registry.js';

import type { CodeKnowledgeDependency } from './types.js';

const TS_JS_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The package name a bare import specifier refers to, or null for a relative import,
 * a path alias, a Node built-in, or a malformed specifier. `chalk/foo` -> `chalk`;
 * `@scope/pkg/sub` -> `@scope/pkg`.
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  if (specifier.startsWith('@/')) {
    return null; // the tsconfig path alias, not a package
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

/**
 * Compute `imported` for every declared node dependency: true when any TS/JS file
 * imports it by name. `contentByFile` is the already-read source of each file.
 */
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
