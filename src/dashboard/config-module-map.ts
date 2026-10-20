import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  readDriftReport,
  readRawModuleMap,
  type ModuleMapDriftReport,
} from '@/module-map/reconciler.js';
import type { SchemaValidationIssue } from '@/validators/validator.js';

import { readManagedFile, writeManagedFile, type ManagedFile } from './write-pipeline.js';

type RawModuleMap = NonNullable<ReturnType<typeof readRawModuleMap>>;
export type RawModule = RawModuleMap['modules'][number];

export class ModuleMapValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'ModuleMapValidationError';
    this.issues = issues;
  }
}

export interface ModuleMapConfig {
  file: ManagedFile;
  modules: RawModule[];
  drift: ModuleMapDriftReport | null;
}

export function getModuleMapConfig(projectRoot: string): ModuleMapConfig {
  return {
    file: readManagedFile(projectRoot, PATHS.MODULE_MAP),
    modules: readRawModuleMap(projectRoot)?.modules ?? [],
    drift: readDriftReport(projectRoot),
  };
}

export interface PutModuleMapInput {
  content: string;
  baseHash: string | null;
}

export interface PutModuleMapResult {
  path: string;
  hash: string;
  modules: RawModule[];
}

export function putModuleMap(projectRoot: string, input: PutModuleMapInput): PutModuleMapResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(input.content);
  } catch (err) {
    throw new ModuleMapValidationError('The file is not valid YAML.', [
      {
        path: '/',
        message: err instanceof Error ? err.message : 'YAML parse failed',
      },
    ]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ModuleMapValidationError('The module map must be a YAML mapping.', [
      { path: '/', message: 'Expected a mapping at the top level.' },
    ]);
  }

  const issues = collectModuleIssues((parsed as Record<string, unknown>)['modules']);
  if (issues.length > 0) {
    throw new ModuleMapValidationError('The module map has invalid module entries.', issues);
  }

  const written = writeManagedFile(projectRoot, {
    relativePath: PATHS.MODULE_MAP,
    content: input.content,
    baseHash: input.baseHash,
    action: 'dashboard.config.module-map.write',
  });

  return {
    path: written.path,
    hash: written.hash,
    modules: readRawModuleMap(projectRoot)?.modules ?? [],
  };
}

function collectModuleIssues(modules: unknown): SchemaValidationIssue[] {
  if (modules === undefined || modules === null) {
    return [];
  }
  if (!Array.isArray(modules)) {
    return [{ path: '/modules', message: 'Expected an array of modules.' }];
  }
  const issues: SchemaValidationIssue[] = [];
  modules.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({ path: `/modules/${index}`, message: 'Expected a module mapping.' });
      return;
    }
    const record = entry as Record<string, unknown>;
    const hasSlug = typeof record['slug'] === 'string' && record['slug'].length > 0;
    const hasName = typeof record['name'] === 'string' && record['name'].length > 0;
    if (!hasSlug && !hasName) {
      issues.push({
        path: `/modules/${index}/slug`,
        message: 'Each module needs a string slug (or name).',
      });
    }
  });
  return issues;
}
