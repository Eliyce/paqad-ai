import type { AdapterType } from './adapter.js';
import type { DetectionReport } from './health.js';
import type { ProjectProfile } from './project-profile.js';
import type { RepositoryContext } from './repository.js';

export interface OnboardingManifest {
  framework_version?: string;
  adapter: AdapterType;
  project_root: string;
  profile: ProjectProfile;
  detected: DetectionReport | null;
  repository?: RepositoryContext;
  generated_at: string;
  generated_artifacts: Array<{
    path: string;
    auto_update: boolean;
    executable?: boolean;
  }>;
  removed_stage_agents?: Array<{
    path: string;
    reason: 'managed-marker' | 'legacy-stamp' | 'generated-body';
  }>;
  planning_artifacts?: {
    compiled_rules_path: string;
    module_health_initialized: string[];
    classifier_config_path?: string;
  };
}

export interface OnboardingOutput {
  adapter: AdapterType;
  decision_pause_supported_adapters: AdapterType[];
  generated_files: string[];
  detected_modules: string[];
  runtime_root: string;
  manifest_path: string;
  warnings: string[];
  kept_files: string[];
  drift_review_targets: string[];
  reverted_framework_values: string[];
}

export interface OnboardingFileTreeEntry {
  path: string;
  action: 'create' | 'overwrite' | 'skip';
  mtimeMs?: number;
  templateError?: string;
}

export interface OnboardingPreviewResult {
  entries: OnboardingFileTreeEntry[];
  warnings: string[];
}
