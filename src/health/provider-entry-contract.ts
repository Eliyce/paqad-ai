import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  buildDecisionPauseContractSection,
  extractDecisionPauseContractSection,
  normalizeProviderEntryContract,
} from '@/adapters/shared/provider-entry-contract.js';

export interface ProviderEntryContractCheckResult {
  status: 'pass' | 'warning' | 'fail';
  detail: string;
  remediation: string;
}

export function inspectProviderEntryDecisionPauseContracts(
  projectRoot: string,
): ProviderEntryContractCheckResult {
  const configPaths = ADAPTER_TYPES.map((type) => ({
    type,
    path: join(projectRoot, AdapterFactory.create(type).getConfigPath()),
  }));
  const existing = configPaths.filter(({ path }) => existsSync(path));

  if (existing.length === 0) {
    return {
      status: 'warning',
      detail: 'No adapter config files were found to check',
      remediation:
        'Generate at least one adapter config before checking the decision pause contract.',
    };
  }

  const missing: string[] = [];
  const drifted: string[] = [];

  for (const { type, path } of existing) {
    const current = readFileSync(path, 'utf8');
    const section = extractDecisionPauseContractSection(current);

    if (section === null) {
      missing.push(relative(projectRoot, path));
      continue;
    }

    const expected = normalizeProviderEntryContract(buildDecisionPauseContractSection(type));
    if (normalizeProviderEntryContract(section) !== expected) {
      drifted.push(relative(projectRoot, path));
    }
  }

  const remediation =
    'Re-run `paqad refresh --providers` to restore the decision pause pointer and managed doc.';

  if (missing.length > 0) {
    return {
      status: 'fail',
      detail: `Decision pause contract missing from: ${missing.join(', ')}`,
      remediation,
    };
  }

  if (drifted.length > 0) {
    return {
      status: 'warning',
      detail: `Decision pause contract drift detected in: ${drifted.join(', ')}`,
      remediation,
    };
  }

  // Also flag a missing canonical doc as drift (warning, not fail — the entry
  // file pointer is still useful even if the managed doc isn't there yet).
  const canonicalPath = join(projectRoot, PATHS.DECISION_PAUSE_CONTRACT);
  if (!existsSync(canonicalPath)) {
    return {
      status: 'warning',
      detail: `Canonical decision pause contract document is missing at ${relative(projectRoot, canonicalPath)}`,
      remediation,
    };
  }

  return {
    status: 'pass',
    detail:
      'Generated adapter config files point at the canonical decision pause contract and the managed doc is present.',
    remediation: 'No action needed.',
  };
}
