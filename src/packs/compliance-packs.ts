import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { COMPLIANCE_RELATIONS, COMPLIANCE_EVIDENCE_STRENGTHS } from '@/core/types/pack.js';
import type {
  CompliancePackManifest,
  CompliancePackRegistry,
  LoadedCompliancePack,
  PackInstallSource,
  PackValidationIssue,
  PackValidationResult,
} from '@/core/types/pack.js';
import { VERIFICATION_GATES } from '@/core/types/verification.js';
import { SchemaValidator } from '@/validators/validator.js';

const SOURCE_ORDER: PackInstallSource[] = ['built-in', 'global', 'project'];

const KNOWN_OBLIGATION_CATEGORIES = new Set([
  'functional',
  'edge-case',
  'acceptance',
  'non-functional',
  'unclassified',
]);

const GATE_NAMES = new Set<string>(VERIFICATION_GATES as readonly string[]);

export interface CompliancePackLoaderOptions {
  runtimeRoot?: string;
  globalPacksRoot?: string;
  projectRoot?: string;
}

export function resolveCompliancePackRoots(
  options: CompliancePackLoaderOptions = {},
): Record<PackInstallSource, string | null> {
  return {
    'built-in': join(options.runtimeRoot ?? getRuntimeRoot(), 'capabilities', 'compliance'),
    global:
      options.globalPacksRoot ??
      process.env.PAQAD_GLOBAL_COMPLIANCE_PACKS_ROOT ??
      join(homedir(), '.paqad', 'compliance-packs'),
    project: options.projectRoot ? join(options.projectRoot, '.paqad', 'compliance-packs') : null,
  };
}

export class CompliancePackLoader {
  private readonly validator = new SchemaValidator();

  load(options: CompliancePackLoaderOptions = {}): CompliancePackRegistry {
    const roots = resolveCompliancePackRoots(options);
    const packs = new Map<string, LoadedCompliancePack>();
    const warnings: PackValidationIssue[] = [];

    for (const source of SOURCE_ORDER) {
      const root = roots[source];
      if (root === null || !existsSync(root)) continue;

      for (const pack of this.loadPacksFromRoot(root, source)) {
        warnings.push(...pack.validation.issues.filter((issue) => issue.level === 'warning'));
        if (!pack.validation.valid) {
          warnings.push(
            ...pack.validation.issues
              .filter((issue) => issue.level === 'error')
              .map((issue) => ({ ...issue, level: 'warning' as const })),
          );
          continue;
        }
        packs.set(pack.manifest.name, pack);
      }
    }

    return { packs, warnings };
  }

  private loadPacksFromRoot(root: string, source: PackInstallSource): LoadedCompliancePack[] {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('_') && !entry.name.startsWith('.'))
      .map((entry) => this.readPack(join(root, entry.name), source));
  }

  readPack(packRoot: string, source: PackInstallSource): LoadedCompliancePack {
    const manifestPath = join(packRoot, 'compliance-pack.yaml');
    const issues: PackValidationIssue[] = [];

    if (!existsSync(manifestPath)) {
      return invalid(packRoot, manifestPath, source, [
        { level: 'error', path: '/', message: 'missing compliance-pack.yaml' },
      ]);
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      return invalid(packRoot, manifestPath, source, [
        {
          level: 'error',
          path: '/',
          message: `unparseable YAML: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }

    const schema = this.validator.validate('compliance-pack', parsed);
    if (!schema.valid) {
      issues.push(
        ...schema.errors.map((error) => ({
          level: 'error' as const,
          path: error.path,
          message: error.message,
        })),
      );
    }

    const manifest = parsed as CompliancePackManifest;
    if (schema.valid) {
      for (const [m, mapping] of (manifest.mappings ?? []).entries()) {
        for (const [s, signal] of (mapping.satisfied_by ?? []).entries()) {
          const at = `/mappings/${m}/satisfied_by/${s}`;
          if (signal.type === 'gate' && !GATE_NAMES.has(signal.ref)) {
            issues.push({ level: 'error', path: at, message: `unknown gate '${signal.ref}'` });
          }
          if (
            signal.type === 'obligation_category' &&
            !KNOWN_OBLIGATION_CATEGORIES.has(signal.ref)
          ) {
            issues.push({
              level: 'error',
              path: at,
              message: `unknown obligation category '${signal.ref}'`,
            });
          }
        }
      }
    }

    const validation: PackValidationResult = {
      valid: issues.every((issue) => issue.level !== 'error'),
      issues,
    };
    return { manifest, root: packRoot, manifestPath, source, validation };
  }
}

function invalid(
  root: string,
  manifestPath: string,
  source: PackInstallSource,
  issues: PackValidationIssue[],
): LoadedCompliancePack {
  return {
    manifest: {
      kind: 'compliance-pack',
      name: '',
      framework: { id: '', title: '' },
      disclaimer: '',
      mappings: [],
    },
    root,
    manifestPath,
    source,
    validation: { valid: false, issues },
  };
}

export function loadCompliancePacks(
  projectRoot: string,
  options: Omit<CompliancePackLoaderOptions, 'projectRoot'> = {},
): LoadedCompliancePack[] {
  const registry = new CompliancePackLoader().load({ ...options, projectRoot });
  return [...registry.packs.values()];
}

export { COMPLIANCE_RELATIONS, COMPLIANCE_EVIDENCE_STRENGTHS };
