export type StackEcosystem = 'node' | 'php' | 'python' | 'ruby' | 'jvm' | 'go' | 'rust' | 'dart';
export type StackProfileSourceKind = 'manifest' | 'lockfile' | 'config' | 'heuristic' | 'fallback';

export interface ToolchainInfo {
  ecosystem: StackEcosystem;
  package_manager: string;
  lockfile: string;
}

export interface InstalledPackage {
  name: string;
  version_constraint: string;
  locked_version: string;
  ecosystem: StackEcosystem;
  is_dev: boolean;
  root?: string;
}

export interface StackSourceReference {
  file: string;
  kind: StackProfileSourceKind;
  detail: string;
}

export interface VersionBand {
  name: string;
  package_name: string;
  range: string;
  locked_version: string;
  source: 'lockfile' | 'manifest';
}

export interface DetectedStackProfile {
  frameworks: string[];
  traits: string[];
  toolchains: ToolchainInfo[];
  version_bands: VersionBand[];
  sources: StackSourceReference[];
}

export interface StackSnapshot {
  generated_at: string;
  source_hashes: Record<string, string>;
  toolchains: ToolchainInfo[];
  packages: InstalledPackage[];
  profile: DetectedStackProfile;
  repository?: import('./repository.js').RepositoryContext;
}

export interface StackDriftChange {
  type:
    | 'framework-added'
    | 'framework-removed'
    | 'trait-added'
    | 'trait-removed'
    | 'version-band-changed'
    | 'toolchain-changed';
  key: string;
  before?: string;
  after?: string;
}

export interface StackDriftReport {
  generated_at: string;
  status: 'no-drift' | 'drift-detected';
  previous_profile: DetectedStackProfile | null;
  current_profile: DetectedStackProfile;
  material_changes: StackDriftChange[];
  newly_active_rule_bands: string[];
  newly_inactive_rule_bands: string[];
  review_targets: string[];
}
