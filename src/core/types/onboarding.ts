import type { AdapterType } from './adapter.js';
import type { DetectionReport } from './health.js';
import type { ProjectProfile } from './project-profile.js';
import type { RepositoryContext } from './repository.js';

export interface OnboardingManifest {
  /**
   * Optional. No longer written into newly generated manifests: it is the one
   * field that churned the tracked manifest on every version bump, and its only
   * reader (graph extraction) null-guards a soft advisory. Kept in the type for
   * back-compat reading of manifests written before it was dropped.
   */
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
}

/**
 * One planned file in an onboarding preview.
 *
 * - `create` — the target does not exist and onboarding would write it.
 * - `overwrite` — the target exists, is auto-updatable, and its on-disk bytes differ
 *   from what onboarding would write. `mtimeMs` carries the existing file's last-changed
 *   time so the consumer can show "this will be replaced" without re-scanning disk.
 * - `skip` — onboarding would not change the file: either it already matches byte-for-byte,
 *   or it exists and is not auto-updatable (project-owned). `mtimeMs` is populated when the
 *   target exists.
 *
 * `templateError` annotates an entry whose on-disk state could not be classified (e.g. a
 * nested path that is unreadable); the preview records the reason and continues rather than
 * failing the whole tree.
 */
export interface OnboardingFileTreeEntry {
  path: string;
  action: 'create' | 'overwrite' | 'skip';
  mtimeMs?: number;
  templateError?: string;
}

/**
 * Result of {@link OnboardingOrchestrator.preview} — a read-only description of every file
 * onboarding would create or change, computed without writing anything to disk.
 *
 * Determinism invariant: two calls with identical arguments and no disk change between them
 * return entry lists that are identical path-for-path and action-for-action. This holds only
 * if the generated content itself is deterministic, so onboarding templates must not embed
 * time- or randomness-dependent output.
 */
export interface OnboardingPreviewResult {
  entries: OnboardingFileTreeEntry[];
  warnings: string[];
}
