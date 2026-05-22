import { REGISTRIES } from '@/core/constants/paths.js';

import { FileRegistryMapper } from './file-registry-mapper.js';

export interface RefreshResult {
  total_registries: number;
  refreshed: number;
  skipped: number;
  registries: string[];
}

export class DifferentialRefresh {
  constructor(private readonly mapper = new FileRegistryMapper()) {}

  async refresh(changedFiles: string[]): Promise<RefreshResult> {
    const affectedRegistries = new Set<string>();

    for (const file of changedFiles) {
      const registries = this.mapper.getAffectedRegistries(file);
      registries.forEach((registry) => affectedRegistries.add(registry));
    }

    return {
      total_registries: REGISTRIES.length,
      refreshed: affectedRegistries.size,
      skipped: REGISTRIES.length - affectedRegistries.size,
      registries: [...affectedRegistries].sort(),
    };
  }
}
