import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CanonicalDocTarget } from '@/core/types/verification.js';
import { validateApiDoc, validateErrorCatalogMarkdown } from '@/validators/index.js';

const STALENESS_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

export async function collectUnresolvedDocTargets(
  projectRoot: string,
  changedFiles: string[],
  staleDocTargets: CanonicalDocTarget[],
): Promise<CanonicalDocTarget[]> {
  const unresolvedTargets = await Promise.all(
    staleDocTargets.map(async (target) => {
      if (!changedFiles.includes(target.target_path)) {
        // Implementation drift: the doc was NOT edited in this diff, so it is only a
        // real obligation if it already EXISTS — a code change cannot stale a
        // canonical doc the project never created. The detector emits framework-
        // assumed owners (docs/maintainers/architecture-map.md, docs/modules/README.md)
        // for any src/runtime/tests change, but onboarding seeds neither, so demanding
        // their *creation* on every code change false-blocks every onboarded repo that
        // has not authored them. An existing drift doc is still returned (flagged), so a
        // project that DOES maintain these docs is reminded to review them; genuinely
        // required per-module docs are enforced separately by the expected-modules
        // checks, which are unaffected. (issue #307, decision D-DOC-DRIFT-EXISTING)
        if (!existsSync(join(projectRoot, target.target_path))) {
          return null;
        }
        return target;
      }

      const validationFailure = await validateCanonicalDocTarget(projectRoot, target.target_path);
      if (validationFailure === null) {
        return null;
      }

      return {
        ...target,
        reason: `${target.reason} Direct edit still unresolved: ${validationFailure}`,
      };
    }),
  );

  return unresolvedTargets.filter((target): target is CanonicalDocTarget => target !== null);
}

export function formatCanonicalDocTarget(target: CanonicalDocTarget): string {
  const ownership =
    target.ownership_kind === 'direct-doc-edit' ? 'direct doc edit' : 'implementation drift';
  const owners = target.owners.length > 0 ? `owners: ${target.owners.join(', ')}` : 'owners: none';
  return `${target.target_path} [${ownership}; ${owners}; reason: ${target.reason}]`;
}

export async function collectCanonicalDocumentationFailures(
  projectRoot: string,
  expectedUiModules: string[],
  expectedApiModules: string[],
  expectedIntegrationModules: string[],
  expectedErrorCatalogModules: string[],
): Promise<string[]> {
  return [
    ...collectMissingDocs(projectRoot, expectedUiModules, ['ui', 'screens.md']),
    ...(await collectApiDocFailures(projectRoot, expectedApiModules)),
    ...(await collectIntegrationDocFailures(projectRoot, expectedIntegrationModules)),
    ...(await collectErrorCatalogFailures(projectRoot, expectedErrorCatalogModules)),
  ];
}

export function areRegistriesStale(registryRefreshedAt: string | null): boolean {
  if (!registryRefreshedAt) {
    return true;
  }

  const parsed = Date.parse(registryRefreshedAt);
  return Number.isNaN(parsed) || Date.now() - parsed > STALENESS_WINDOW_MS;
}

async function collectApiDocFailures(projectRoot: string, modules: string[]): Promise<string[]> {
  const failures: string[] = [];

  for (const moduleName of modules) {
    const modulePath = join(projectRoot, 'docs', 'modules', moduleName);
    const result = await checkApiDocs(modulePath);
    if (!result.passed) {
      failures.push(result.detail);
    }
  }

  return failures;
}

async function collectIntegrationDocFailures(
  projectRoot: string,
  modules: string[],
): Promise<string[]> {
  const failures: string[] = [];

  for (const moduleName of modules) {
    const modulePath = join(projectRoot, 'docs', 'modules', moduleName);
    const result = await checkIntegrationDocs(modulePath);
    if (!result.passed) {
      failures.push(result.detail);
    }
  }

  return failures;
}

async function collectErrorCatalogFailures(
  projectRoot: string,
  modules: string[],
): Promise<string[]> {
  const failures: string[] = [];

  for (const moduleName of modules) {
    const modulePath = join(projectRoot, 'docs', 'modules', moduleName);
    const result = await checkErrorCatalog(modulePath);
    if (!result.passed) {
      failures.push(result.detail);
    }
  }

  return failures;
}

async function checkApiDocs(modulePath: string): Promise<{ passed: boolean; detail: string }> {
  const endpointsPath = join(modulePath, 'api', 'endpoints.md');
  const endpointsExists = existsSync(endpointsPath);
  const schemasExists = existsSync(join(modulePath, 'api', 'schemas.md'));
  const errorCodesExists = existsSync(join(modulePath, 'api', 'error-codes.md'));

  if (!endpointsExists || !schemasExists || !errorCodesExists) {
    return {
      passed: false,
      detail: `Missing API docs in ${modulePath}: ${[
        !endpointsExists && 'endpoints.md',
        !schemasExists && 'schemas.md',
        !errorCodesExists && 'error-codes.md',
      ]
        .filter(Boolean)
        .join(', ')}`,
    };
  }

  const endpointsValidation = validateApiDoc(await readFile(endpointsPath, 'utf8'));
  if (!endpointsValidation.valid) {
    return {
      passed: false,
      detail: `Invalid API docs in ${modulePath}: ${endpointsValidation.errors.join('; ')}`,
    };
  }

  return { passed: true, detail: 'API docs present' };
}

async function checkIntegrationDocs(
  modulePath: string,
): Promise<{ passed: boolean; detail: string }> {
  const eventsExists = existsSync(join(modulePath, 'integration', 'events.md'));
  const contractsExists = existsSync(join(modulePath, 'integration', 'contracts.md'));

  if (!eventsExists || !contractsExists) {
    return {
      passed: false,
      detail: `Missing integration docs in ${modulePath}: ${[
        !eventsExists && 'events.md',
        !contractsExists && 'contracts.md',
      ]
        .filter(Boolean)
        .join(', ')}`,
    };
  }

  return { passed: true, detail: 'Integration docs present' };
}

async function checkErrorCatalog(modulePath: string): Promise<{ passed: boolean; detail: string }> {
  const catalogPath = join(modulePath, 'error-catalog.md');
  const catalogExists = existsSync(catalogPath);

  if (!catalogExists) {
    return {
      passed: false,
      detail: `Missing error-catalog.md in ${modulePath}`,
    };
  }

  const validation = validateErrorCatalogMarkdown(await readFile(catalogPath, 'utf8'));
  if (!validation.valid) {
    return {
      passed: false,
      detail: `Invalid error catalog in ${modulePath}: ${validation.errors.join('; ')}`,
    };
  }

  return { passed: true, detail: 'Error catalog present' };
}

function collectMissingDocs(projectRoot: string, modules: string[], segments: string[]): string[] {
  return modules
    .map((moduleName) => ({
      moduleName,
      path: join(projectRoot, 'docs', 'modules', moduleName, ...segments),
    }))
    .filter((entry) => !existsSync(entry.path))
    .map((entry) => `${entry.moduleName}:${segments.join('/')}`);
}

async function validateCanonicalDocTarget(
  projectRoot: string,
  targetPath: string,
): Promise<string | null> {
  const absolutePath = join(projectRoot, targetPath);
  if (!existsSync(absolutePath)) {
    return 'file does not exist';
  }

  if (!targetPath.endsWith('.md')) {
    return null;
  }

  const markdown = await readFile(absolutePath, 'utf8');
  if (markdown.trim().length === 0) {
    return 'markdown file is empty';
  }

  if (targetPath.endsWith('/api/endpoints.md')) {
    const validation = validateApiDoc(markdown);
    return validation.valid ? null : validation.errors.join('; ');
  }

  if (targetPath.endsWith('/error-catalog.md')) {
    const validation = validateErrorCatalogMarkdown(markdown);
    return validation.valid ? null : validation.errors.join('; ');
  }

  if (!/^#{1,6}\s+\S+/m.test(markdown)) {
    return 'markdown file is missing a heading';
  }

  return null;
}
