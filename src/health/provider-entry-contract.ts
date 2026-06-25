import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { buildFrameworkFallbackClause } from '@/adapters/shared/framework-fallback-clause.js';
import { PATHS } from '@/core/constants/paths.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

export interface ProviderEntryContractCheckResult {
  status: 'pass' | 'warning' | 'fail';
  detail: string;
  remediation: string;
}

const REMEDIATION = 'Re-run `paqad refresh --providers` to regenerate the lean entry stubs.';

/**
 * Section markers a pre-#229 "fat" entry file carried. Issue #229 moved the load
 * order and BOTH contracts into the install bootstrap, so a lean stub must inline
 * none of these.
 */
const STALE_FAT_MARKERS: readonly string[] = [
  '## Decision Pause Contract',
  '# Decision Pause Contract',
  '## paqad in your chat',
  '# paqad narration contract',
];

interface PresentEntryFile {
  relativePath: string;
  content: string;
}

function presentEntryFiles(projectRoot: string): PresentEntryFile[] {
  return ADAPTER_TYPES.map((type) => join(projectRoot, AdapterFactory.create(type).getConfigPath()))
    .filter((path) => existsSync(path))
    .map((path) => ({
      relativePath: relative(projectRoot, path),
      content: readFileSync(path, 'utf8'),
    }));
}

function noEntryFiles(kind: string): ProviderEntryContractCheckResult {
  return {
    status: 'warning',
    detail: 'No adapter config files were found to check',
    remediation: `Generate at least one adapter config before checking the ${kind}.`,
  };
}

/**
 * Issue #229 — every provider entry file must be a LEAN stub: it points to the
 * framework bootstrap via `.paqad/framework-path.txt` and inlines NO contract.
 * A stale pre-#229 fat entry file (still carrying a `## Decision Pause Contract`
 * or `## paqad in your chat` section) is flagged so a refresh restores the lean
 * shape. The contracts themselves now live in the install bootstrap, not the
 * project, so there is no per-project contract doc to check.
 */
export function inspectProviderEntryBootstrapPointer(
  projectRoot: string,
): ProviderEntryContractCheckResult {
  const entries = presentEntryFiles(projectRoot);
  if (entries.length === 0) {
    return noEntryFiles('bootstrap pointer');
  }

  const missingPointer = entries
    .filter((entry) => !entry.content.includes(PATHS.FRAMEWORK_PATH))
    .map((entry) => entry.relativePath);
  if (missingPointer.length > 0) {
    return {
      status: 'fail',
      detail: `Bootstrap pointer (${PATHS.FRAMEWORK_PATH}) missing from: ${missingPointer.join(', ')}`,
      remediation: REMEDIATION,
    };
  }

  const stillFat = entries
    .filter((entry) => STALE_FAT_MARKERS.some((marker) => entry.content.includes(marker)))
    .map((entry) => entry.relativePath);
  if (stillFat.length > 0) {
    return {
      status: 'warning',
      detail: `Stale (pre-#229) entry file still inlines a contract section in: ${stillFat.join(', ')}`,
      remediation: REMEDIATION,
    };
  }

  return {
    status: 'pass',
    detail: 'Every generated entry file is a lean stub pointing to the framework bootstrap.',
    remediation: 'No action needed.',
  };
}

/**
 * Issue #220/#229 — every provider entry file must carry the core-owned
 * graceful-degradation fallback clause (byte-identical across hosts), so a
 * missing or disabled paqad never hard-fails the host.
 */
export function inspectProviderEntryFallbackClause(
  projectRoot: string,
): ProviderEntryContractCheckResult {
  const entries = presentEntryFiles(projectRoot);
  if (entries.length === 0) {
    return noEntryFiles('fallback clause');
  }

  const clause = buildFrameworkFallbackClause();
  const missing = entries
    .filter((entry) => !entry.content.includes(clause))
    .map((entry) => entry.relativePath);
  if (missing.length > 0) {
    return {
      status: 'fail',
      detail: `Graceful-degradation fallback clause missing from: ${missing.join(', ')}`,
      remediation: REMEDIATION,
    };
  }

  return {
    status: 'pass',
    detail: 'Every generated entry file carries the graceful-degradation fallback clause.',
    remediation: 'No action needed.',
  };
}
