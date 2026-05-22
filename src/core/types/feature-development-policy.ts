import type { ProjectProfile } from './project-profile.js';

export const FEATURE_DEVELOPMENT_STAGE_NAMES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
] as const;

export type FeatureDevelopmentStageName = (typeof FEATURE_DEVELOPMENT_STAGE_NAMES)[number];

export const FEATURE_DEVELOPMENT_ESCALATION_ACTIONS = ['warn', 'ask', 'stop'] as const;
export type FeatureDevelopmentEscalationAction =
  (typeof FEATURE_DEVELOPMENT_ESCALATION_ACTIONS)[number];

export type FeatureDevelopmentLogicalCommand = keyof ProjectProfile['commands'];

export interface FeatureDevelopmentChecksPolicy {
  use_project_profile_commands: boolean;
  commands: FeatureDevelopmentLogicalCommand[];
  shell_commands: string[];
  block_on_failure: boolean;
}

export interface FeatureDevelopmentStagePolicy {
  read: string[];
  instructions: string[];
  required_inputs: string[];
  strictness: Record<string, boolean>;
  escalation: Record<string, FeatureDevelopmentEscalationAction>;
  artifacts: string[];
  checks: FeatureDevelopmentChecksPolicy | null;
}

export interface FeatureDevelopmentPolicy {
  schema_version: '1';
  merge_mode: 'append';
  stages: Record<FeatureDevelopmentStageName, FeatureDevelopmentStagePolicy>;
}

export interface FeatureDevelopmentPolicyLoadResult {
  policy: FeatureDevelopmentPolicy;
  warnings: string[];
}

export interface ResolvedFeatureDevelopmentCheckCommand {
  logical_command: FeatureDevelopmentLogicalCommand | null;
  command: string;
  source: 'project-profile' | 'policy';
}
