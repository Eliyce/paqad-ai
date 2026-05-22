import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

const REQUIRED_FEATURE_DOCS = ['business.md', 'technical.md', 'api.md'] as const;

interface FeatureScope {
  module: string;
  feature: string;
}

export class ModuleDocsStructureGate implements Gate {
  readonly gate = 'module-docs-structure' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const changedFiles = context.changed_files.map(normalizePath);
    const legacyPath = changedFiles.find((filePath) => isUnderPath(filePath, 'docs/module/'));
    if (legacyPath) {
      return createFail(
        this.gate,
        `Invalid module documentation path ${legacyPath}; use docs/modules/`,
        'Move feature documentation under docs/modules/{module}/features/{feature}/ before completing the provider request.',
      );
    }

    const moduleDocPaths = changedFiles.filter((filePath) =>
      isUnderPath(filePath, 'docs/modules/'),
    );
    if (moduleDocPaths.length === 0) {
      return createPass(this.gate, 'No module feature documentation changes detected');
    }

    const invalidFeatureDoc = moduleDocPaths.find((filePath) => isInvalidFeatureDocPath(filePath));
    if (invalidFeatureDoc) {
      return createFail(
        this.gate,
        `Feature documentation path ${invalidFeatureDoc} is outside docs/modules/{module}/features/{feature}/`,
        'Place feature documentation under docs/modules/{module}/features/{feature}/ with business.md, technical.md, and api.md.',
      );
    }

    const scopes = collectTouchedFeatureScopes(moduleDocPaths);
    if (scopes.length === 0) {
      return createPass(this.gate, 'No module feature documentation changes detected');
    }

    for (const scope of scopes) {
      for (const filename of REQUIRED_FEATURE_DOCS) {
        const relativePath = `docs/modules/${scope.module}/features/${scope.feature}/${filename}`;
        const absolutePath = join(context.project_root, ...relativePath.split('/'));
        if (!existsSync(absolutePath)) {
          return createFail(
            this.gate,
            `Missing ${relativePath}`,
            `Create the missing feature-level ${formatDocKind(filename)} documentation file before completing the provider request.`,
          );
        }

        const markdown = await readFile(absolutePath, 'utf8');
        if (markdown.trim().length === 0) {
          return createFail(
            this.gate,
            `Required documentation file ${relativePath} is empty`,
            'Add non-empty markdown content before completing the provider request.',
          );
        }

        if (!hasMarkdownHeading(markdown)) {
          return createFail(
            this.gate,
            `Required documentation file ${relativePath} does not contain a heading`,
            'Add at least one markdown heading before completing the provider request.',
          );
        }
      }
    }

    return createPass(this.gate, 'Module feature documentation structure is valid');
  }
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}

function isUnderPath(filePath: string, prefix: string): boolean {
  return filePath === prefix.slice(0, -1) || filePath.startsWith(prefix);
}

function isInvalidFeatureDocPath(filePath: string): boolean {
  if (!filePath.endsWith('.md')) {
    return false;
  }

  const segments = filePath.split('/');
  const featuresIndex = segments.indexOf('features');
  if (featuresIndex === -1) {
    return false;
  }

  return (
    segments.length !== 6 ||
    segments[0] !== 'docs' ||
    segments[1] !== 'modules' ||
    segments[3] !== 'features' ||
    segments[2].length === 0 ||
    segments[4].length === 0 ||
    !REQUIRED_FEATURE_DOCS.includes(segments[5] as (typeof REQUIRED_FEATURE_DOCS)[number])
  );
}

function collectTouchedFeatureScopes(filePaths: string[]): FeatureScope[] {
  const scopeKeys = new Set<string>();
  const scopes: FeatureScope[] = [];

  for (const filePath of filePaths) {
    const segments = filePath.split('/');
    if (
      segments.length === 6 &&
      segments[0] === 'docs' &&
      segments[1] === 'modules' &&
      segments[3] === 'features' &&
      REQUIRED_FEATURE_DOCS.includes(segments[5] as (typeof REQUIRED_FEATURE_DOCS)[number])
    ) {
      const scope = { module: segments[2], feature: segments[4] };
      const key = `${scope.module}/${scope.feature}`;
      if (!scopeKeys.has(key)) {
        scopeKeys.add(key);
        scopes.push(scope);
      }
    }
  }

  return scopes;
}

function hasMarkdownHeading(markdown: string): boolean {
  return markdown.split(/\r?\n/u).some((line) => /^#{1,6}\s+\S/u.test(line.trim()));
}

function formatDocKind(filename: (typeof REQUIRED_FEATURE_DOCS)[number]): string {
  return filename.replace('.md', '');
}
