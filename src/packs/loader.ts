import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import YAML from 'yaml';

import { MCP_SERVER_TYPES } from '@/core/types/mcp.js';
import type {
  LoadedStackPack,
  PackInstallSource,
  PackRegistry,
  PackValidationIssue,
  PackValidationResult,
  StackPackManifest,
  StackPackTestRunner,
} from '@/core/types/pack.js';
import {
  emitSkillAuditEvent,
  getSharedSkillAuditBuffer,
  type SkillAuditBuffer,
  type SkillPackLoadFailedEvent,
} from '@/skills/audit-events.js';
import { SchemaValidator } from '@/validators/validator.js';

const KNOWN_PENTEST_CHECKS = new Set([
  'dependency-advisory-triage',
  'permission-boundary-review',
  'business-logic-abuse-review',
  'input-validation',
  'runtime-surface-probing',
  'finding-normalizer',
  'retest-verification',
]);

const SOURCE_ORDER: PackInstallSource[] = ['built-in', 'global', 'project'];

export interface StackPackLoaderOptions {
  runtimeRoot: string;
  globalPacksRoot?: string;
  projectRoot?: string;
}

export class StackPackLoader {
  private readonly validator = new SchemaValidator();

  constructor(private readonly auditBuffer: SkillAuditBuffer = getSharedSkillAuditBuffer()) {}

  load(options: StackPackLoaderOptions): PackRegistry {
    const candidates = new Map<string, LoadedStackPack>();
    const warnings: PackValidationIssue[] = [];

    for (const source of SOURCE_ORDER) {
      const packsRoot = this.resolvePacksRoot(source, options);
      if (packsRoot === null || !existsSync(packsRoot)) {
        continue;
      }

      for (const pack of this.loadPacksFromRoot(packsRoot, source)) {
        warnings.push(...pack.validation.issues.filter((issue) => issue.level === 'warning'));

        if (!pack.validation.valid) {
          warnings.push(
            ...pack.validation.issues
              .filter((issue) => issue.level === 'error')
              .map((issue) => ({
                ...issue,
                level: 'warning' as const,
              })),
          );
          // PQD-194 — record the quarantine so the desktop can badge the pack.
          emitSkillAuditEvent(
            buildPackLoadFailedEvent(pack),
            options.projectRoot,
            this.auditBuffer,
          );
          continue;
        }

        candidates.set(pack.manifest.name, pack);
      }
    }

    return {
      packs: candidates,
      warnings,
    };
  }

  validatePack(packRoot: string, source: PackInstallSource = 'project'): LoadedStackPack {
    return this.readPack(packRoot, source);
  }

  private resolvePacksRoot(
    source: PackInstallSource,
    options: StackPackLoaderOptions,
  ): string | null {
    if (source === 'built-in') {
      return join(options.runtimeRoot, 'capabilities', 'coding', 'stacks');
    }

    if (source === 'global') {
      return options.globalPacksRoot ?? null;
    }

    return options.projectRoot ? join(options.projectRoot, '.paqad', 'packs') : null;
  }

  private loadPacksFromRoot(root: string, source: PackInstallSource): LoadedStackPack[] {
    return (
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        // Convention directories (leading `_` or `.`) hold shared inheritance
        // assets (e.g. `_shared/rules`) or VCS metadata — they are never packs, so
        // they must not be enumerated as missing-manifest pack candidates (which
        // would otherwise emit a spurious `skill.pack_load_failed` audit event on
        // every load — PQD-194).
        .filter((entry) => !entry.name.startsWith('_') && !entry.name.startsWith('.'))
        .map((entry) => this.readPack(join(root, entry.name), source))
    );
  }

  private readPack(packRoot: string, source: PackInstallSource): LoadedStackPack {
    const manifestPath = join(packRoot, 'pack.yaml');
    const issues: PackValidationIssue[] = [];

    if (!existsSync(manifestPath)) {
      return {
        manifest: createPlaceholderManifest(packRoot),
        root: packRoot,
        manifestPath,
        source,
        validation: {
          valid: false,
          issues: [
            {
              level: 'error',
              path: '/pack.yaml',
              message: 'Missing pack.yaml',
            },
          ],
        },
      };
    }

    let manifest: StackPackManifest | null = null;

    try {
      manifest = YAML.parse(readFileSync(manifestPath, 'utf8')) as StackPackManifest;
    } catch {
      issues.push({
        level: 'error',
        path: '/pack.yaml',
        message: 'pack.yaml is not valid YAML',
      });
    }

    if (manifest !== null) {
      const schema = this.validator.validate('stack-pack', manifest);
      issues.push(
        ...schema.errors.map((error) => ({
          level: 'error' as const,
          path: error.path,
          message: error.message,
        })),
      );
      issues.push(...validatePackReferences(manifest, packRoot));
      issues.push(...validateTraitNames(manifest));
      issues.push(...validateMcpDefaults(manifest));
      issues.push(...validatePentestChecks(manifest));
      issues.push(...validateArchetypePack(manifest));
      issues.push(...validateTestRunners(manifest));
    }

    const validation: PackValidationResult = {
      valid: issues.every((issue) => issue.level !== 'error'),
      issues,
    };

    return {
      manifest: manifest ?? createPlaceholderManifest(packRoot),
      root: packRoot,
      manifestPath,
      source,
      validation,
    };
  }
}

function validateTraitNames(manifest: StackPackManifest): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const seen = new Set<string>();

  for (const trait of manifest.traits ?? []) {
    if (seen.has(trait.name)) {
      issues.push({
        level: 'error',
        path: '/traits',
        message: `Duplicate trait name "${trait.name}"`,
      });
      continue;
    }
    seen.add(trait.name);
  }

  return issues;
}

function validatePackReferences(
  manifest: StackPackManifest,
  packRoot: string,
): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const fileRefs = [manifest.docs?.overview_template, manifest.docs?.conventions_template].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );

  for (const fileRef of fileRefs) {
    const absolutePath = resolve(packRoot, fileRef);
    if (!existsSync(absolutePath)) {
      issues.push({
        level: 'error',
        path: '/docs',
        message: `Referenced file does not exist: ${fileRef}`,
      });
    }
  }

  return issues;
}

function validateMcpDefaults(manifest: StackPackManifest): PackValidationIssue[] {
  return (manifest.mcp_defaults ?? [])
    .filter((item) => !MCP_SERVER_TYPES.includes(item.name as (typeof MCP_SERVER_TYPES)[number]))
    .map((item) => ({
      level: 'warning' as const,
      path: '/mcp_defaults',
      message: `Unknown MCP server "${item.name}" will be treated as custom`,
    }));
}

function validatePentestChecks(manifest: StackPackManifest): PackValidationIssue[] {
  return (manifest.pentest?.file_check_map ?? [])
    .flatMap((item) => item.checks)
    .filter((check) => !KNOWN_PENTEST_CHECKS.has(check))
    .map((check) => ({
      level: 'warning' as const,
      path: '/pentest/file_check_map',
      message: `Unknown pentest check "${check}" will be treated as custom`,
    }));
}

function validateArchetypePack(manifest: StackPackManifest): PackValidationIssue[] {
  if (manifest.tier !== 'archetype') return [];

  const issues: PackValidationIssue[] = [];

  if (!manifest.ecosystem || manifest.ecosystem === 'unknown') {
    issues.push({
      level: 'error',
      path: '/ecosystem',
      message: 'Archetype packs must declare an ecosystem',
    });
  }

  const allRules = [
    ...(manifest.detection.manifests ?? []),
    ...(manifest.detection.lockfiles ?? []),
    ...(manifest.detection.heuristics ?? []),
  ];

  const hasFieldRule = allRules.some(
    (rule) =>
      (rule.fields && rule.fields.length > 0) ||
      (rule.field_absent && rule.field_absent.length > 0),
  );
  const hasHeuristic = (manifest.detection.heuristics?.length ?? 0) > 0;

  if (!hasFieldRule && !hasHeuristic) {
    issues.push({
      level: 'warning',
      path: '/detection',
      message:
        'Archetype pack uses only package-based detection — consider adding fields or heuristics rules to avoid overlap with framework packs',
    });
  }

  return issues;
}

function validateTestRunners(manifest: StackPackManifest): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const seen = new Set<string>();

  for (const runner of manifest.test_runners ?? []) {
    if (seen.has(runner.runner_id)) {
      issues.push({
        level: 'error',
        path: '/test_runners',
        message: `Duplicate test runner "${runner.runner_id}"`,
      });
    }
    seen.add(runner.runner_id);

    if ((runner.output_source ?? 'stdout') === 'file' && !runner.output_path_pattern) {
      issues.push({
        level: 'error',
        path: '/test_runners',
        message: `Test runner "${runner.runner_id}" uses file output without output_path_pattern`,
      });
    }

    if ((runner.output_source ?? 'stdout') === 'stdout' && runner.output_path_pattern) {
      issues.push({
        level: 'warning',
        path: '/test_runners',
        message: `Test runner "${runner.runner_id}" declares output_path_pattern but reads from stdout`,
      });
    }
  }

  issues.push(...validateTestingFrameworkCoverage(manifest));
  return issues;
}

function validateTestingFrameworkCoverage(manifest: StackPackManifest): PackValidationIssue[] {
  const runnersById = new Map(
    (manifest.test_runners ?? []).map((runner) => [runner.runner_id.toLowerCase(), runner]),
  );

  return (manifest.testing?.frameworks ?? [])
    .filter((framework) => !hasMatchingRunner(framework.name, runnersById))
    .map((framework) => ({
      level: 'warning' as const,
      path: '/test_runners',
      message: `Testing framework "${framework.name}" has no matching test_runners declaration`,
    }));
}

function hasMatchingRunner(
  frameworkName: string,
  runnersById: Map<string, StackPackTestRunner>,
): boolean {
  const aliases = new Set(
    [frameworkName, frameworkName.replace(/\s+/g, '-')]
      .flatMap((value) => [value, value.toLowerCase()])
      .filter((value) => value.length > 0),
  );

  if (frameworkName.toLowerCase() === 'pest') aliases.add('phpunit');
  if (frameworkName.toLowerCase() === 'vitest') aliases.add('jest');

  return [...aliases].some((alias) => runnersById.has(alias));
}

/**
 * Build the `skill.pack_load_failed` audit event for a quarantined pack
 * (PQD-194). When the manifest file exists the content hash is taken over its
 * bytes (so an unchanged invalid pack.yaml re-emits an identical hash for
 * de-dup); when it is absent there is nothing to hash, so the pack-root path
 * string is hashed instead. `validation_error_code` distinguishes the two
 * failure classes; `pack_id` is the manifest name, which falls back to the last
 * path segment via the placeholder manifest when the id is unrecoverable.
 */
function buildPackLoadFailedEvent(pack: LoadedStackPack): SkillPackLoadFailedEvent {
  const errorIssues = pack.validation.issues.filter((issue) => issue.level === 'error');
  const manifestExists = existsSync(pack.manifestPath);
  const content_hash = manifestExists
    ? createHash('sha256').update(readFileSync(pack.manifestPath)).digest('hex')
    : createHash('sha256').update(pack.root).digest('hex');

  return {
    ts: new Date().toISOString(),
    type: 'skill.pack_load_failed',
    pack_id: pack.manifest.name,
    pack_path: pack.root,
    validation_error_code: manifestExists ? 'PACK_VALIDATION_FAILED' : 'PACK_MANIFEST_MISSING',
    issue_count: errorIssues.length,
    content_hash,
  };
}

function createPlaceholderManifest(packRoot: string): StackPackManifest {
  return {
    name: packRoot.split('/').at(-1) ?? 'unknown-pack',
    display_name: 'Unknown Pack',
    ecosystem: 'unknown',
    version: '0.0.0',
    description: 'Invalid pack placeholder',
    maintainer: 'unknown',
    detection: {},
  };
}
