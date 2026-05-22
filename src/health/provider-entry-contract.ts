import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
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
  const configPaths = ADAPTER_TYPES.map((type) => AdapterFactory.create(type).getConfigPath());
  const existing = configPaths
    .map((configPath) => join(projectRoot, configPath))
    .filter((configPath) => existsSync(configPath));

  if (existing.length === 0) {
    return {
      status: 'warning',
      detail: 'No adapter config files were found to check',
      remediation:
        'Generate at least one adapter config before checking the decision pause contract.',
    };
  }

  const expected = normalizeProviderEntryContract(buildDecisionPauseContractSection());
  const missing: string[] = [];
  const drifted: string[] = [];

  for (const configPath of existing) {
    const current = readFileSync(configPath, 'utf8');
    const section = extractDecisionPauseContractSection(current);

    if (section === null) {
      missing.push(relative(projectRoot, configPath));
      continue;
    }

    if (normalizeProviderEntryContract(section) !== expected) {
      drifted.push(relative(projectRoot, configPath));
    }
  }

  if (missing.length > 0) {
    return {
      status: 'fail',
      detail: `Decision pause contract missing from: ${missing.join(', ')}`,
      remediation: 'Re-run onboarding or refresh to restore the decision pause instructions.',
    };
  }

  if (drifted.length > 0) {
    return {
      status: 'warning',
      detail: `Decision pause contract drift detected in: ${drifted.join(', ')}`,
      remediation: 'Re-run onboarding or refresh to restore the decision pause instructions.',
    };
  }

  return {
    status: 'pass',
    detail: 'Generated adapter config files include the decision pause contract',
    remediation: 'No action needed.',
  };
}
