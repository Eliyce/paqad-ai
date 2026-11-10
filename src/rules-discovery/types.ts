import type { StackEcosystem } from '@/core/types/introspection.js';

export type PackageStatus = 'new' | 'removed' | 'version-changed' | 'unchanged';

export type PrivateReason =
  'workspace-source' | 'local-path' | 'git-source' | 'workspace-package' | 'private-registry';

export interface InventoryPackage {
  name: string;
  ecosystem: StackEcosystem;
  declared: string | null;
  installed: string | null;
  manifest: string;
  dev: boolean;
  import_count: number | null;
  unused: boolean;
  status: PackageStatus;
  private: boolean;
  private_reason?: PrivateReason;
  description?: string;
}

export interface StackInventory {
  schema_version: 1;
  generated_at: string;
  run_id: string;
  packages: InventoryPackage[];
  frameworks: string[];
  manifests: string[];
  manifests_looked_for: string[];
  compared_to: string | null;
}

export interface BaselinePackage {
  name: string;
  ecosystem: string;
  declared: string | null;
  installed: string | null;
  dev: boolean;
}

export interface RulesDiscoveryBaseline {
  schema_version: 1;
  source: 'seed' | 'run';
  inventory: string | null;
  run_id: string | null;
  seeded_from: string | null;
  updated_at: string;
  packages: BaselinePackage[];
}
