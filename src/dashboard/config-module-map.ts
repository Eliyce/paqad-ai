import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  readDriftReport,
  readRawModuleMap,
  type ModuleMapDriftReport,
} from '@/module-map/reconciler.js';
import type { SchemaValidationIssue } from '@/validators/validator.js';

import { readManagedFile, writeManagedFile, type ManagedFile } from './write-pipeline.js';

/**
 * Issue #146: `/api/config/module-map`. Reads go through `readRawModuleMap`,
 * the same lenient reader the reconciler uses, so the dashboard shows the
 * modules exactly as the drift detector sees them, alongside the latest
 * drift report. Writes carry the raw YAML text (the client edits a YAML
 * document so comments survive) and run the section 6.2 pipeline: shape
 * validation, guarded write, audit, SSE (the server broadcasts after every
 * mutation).
 */

/** The lenient module shape `readRawModuleMap` produces. */
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
  /** The raw project file plus the hash a PUT must echo back. */
  file: ManagedFile;
  /** The declared modules as the reconciler reads them (lenient parse). */
  modules: RawModule[];
  /** The latest drift report, or null when none has been written yet. */
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

/**
 * Validates the candidate map to the same tolerance as `readRawModuleMap`:
 * the document must be a mapping, and `modules` (when present) must be an
 * array of mappings each carrying a string `slug` or `name`. Anything the
 * reconciler would silently coerce into an empty identifier is rejected
 * here instead, so the dashboard cannot save a map the reconciler cannot
 * attribute findings to.
 */
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
