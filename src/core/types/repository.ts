import type { StackEcosystem } from './introspection.js';

export type RepositoryProjectRole = 'standalone' | 'component';

export interface RepositoryProjectCandidate {
  root: string;
  role: RepositoryProjectRole;
  parent_root: string | null;
  markers: string[];
  ecosystems: StackEcosystem[];
}

export interface RepositoryApplication {
  root: string;
  component_roots: string[];
}

export interface RepositoryContext {
  selected_root: string;
  scan_max_depth: number;
  ignored_paths: string[];
  projects: RepositoryProjectCandidate[];
  applications: RepositoryApplication[];
  primary_project_root: string | null;
}
