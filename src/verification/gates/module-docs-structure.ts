import { existsSync, readdirSync } from 'node:fs';
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

    // #313 finding 2 (same family as #310): a flat `docs/modules/{module}/
    // features/{feature}.md` layout is a legitimate repo-wide convention. When it
    // already exists on disk, this change did NOT introduce the non-compliant
    // path — it merely touched a pre-existing file — so blocking here would force
    // the agent to REVERT a correct doc-sync. Scope the structure check to the
    // paths this change is responsible for: ignore flat feature docs once the flat
    // convention is established repo-wide. A lone flat doc introduced into an
    // otherwise-nested repo still fails.
    const scopedPaths = hasPreexistingFlatFeatureDocs(context.project_root, new Set(changedFiles))
      ? moduleDocPaths.filter((filePath) => !isFlatFeatureDoc(filePath))
      : moduleDocPaths;

    const invalidFeatureDoc = scopedPaths.find((filePath) => isInvalidFeatureDocPath(filePath));
    if (invalidFeatureDoc) {
      return createFail(
        this.gate,
        `Feature documentation path ${invalidFeatureDoc} is outside docs/modules/{module}/features/{feature}/`,
        'Place feature documentation under docs/modules/{module}/features/{feature}/ with business.md, technical.md, and api.md.',
      );
    }

    const scopes = collectTouchedFeatureScopes(scopedPaths);
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

/**
 * True for a flat feature doc `docs/modules/{module}/features/{feature}.md`
 * (5 segments) — the alternative to the nested `features/{feature}/{business,
 * technical,api}.md` layout.
 */
function isFlatFeatureDoc(filePath: string): boolean {
  const segments = filePath.split('/');
  return (
    segments.length === 5 &&
    segments[0] === 'docs' &&
    segments[1] === 'modules' &&
    segments[2].length > 0 &&
    segments[3] === 'features' &&
    segments[4].length > '.md'.length &&
    segments[4].endsWith('.md')
  );
}

/**
 * True when at least one flat feature doc already exists on disk under
 * `docs/modules/{module}/features/` that is NOT part of the current change
 * (`changedSet`) — evidence the flat layout is the repo's established convention,
 * not something this change introduced. Best-effort: any fs error → false.
 */
function hasPreexistingFlatFeatureDocs(projectRoot: string, changedSet: Set<string>): boolean {
  const modulesRoot = join(projectRoot, 'docs', 'modules');
  if (!existsSync(modulesRoot)) {
    return false;
  }
  let moduleEntries: string[];
  try {
    moduleEntries = readdirSync(modulesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    // Defensive: existsSync already guards absence; a docs/modules that exists but
    // is unreadable (permission flip / not a directory) is not reachable through
    // the test fixture, which always creates it as a readable directory.
    /* v8 ignore next 2 */
  } catch {
    return false;
  }
  for (const moduleName of moduleEntries) {
    const featuresDir = join(modulesRoot, moduleName, 'features');
    let featureEntries: string[];
    try {
      featureEntries = readdirSync(featuresDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const filename of featureEntries) {
      const relativePath = `docs/modules/${moduleName}/features/${filename}`;
      if (!changedSet.has(relativePath)) {
        return true;
      }
    }
  }
  return false;
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
