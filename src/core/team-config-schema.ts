import type { OwnTeamConfigFile } from './team-config-values.js';

export type JsonSchema = Record<string, unknown>;

export interface StructuredTeamSetting {
  file: OwnTeamConfigFile;
  path: readonly string[];
  schema: JsonSchema;
}

export const WORKFLOW_POLICY_STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
  'delivery',
] as const;

export const MODULE_ATTRIBUTION_MODES = ['defer', 'stop'] as const;
export const CHECKS_ON_FAILURE_MODES = ['block', 'warn'] as const;

const STRING_LIST: JsonSchema = { type: 'array', items: { type: 'string' } };

export const STRUCTURED_TEAM_SETTINGS: readonly StructuredTeamSetting[] = [
  ...WORKFLOW_POLICY_STAGES.flatMap((stage): StructuredTeamSetting[] => [
    {
      file: 'feature-development/workflow.yaml',
      path: ['stages', stage, 'read'],
      schema: {
        ...STRING_LIST,
        description: `Paths added to paqad's own read list for the ${stage} stage.`,
      },
    },
    {
      file: 'feature-development/workflow.yaml',
      path: ['stages', stage, 'instructions'],
      schema: {
        ...STRING_LIST,
        description: `Instructions added after paqad's own instructions for the ${stage} stage.`,
      },
    },
  ]),
  {
    file: 'feature-development/workflow.yaml',
    path: ['stages', 'planning', 'module_attribution'],
    schema: {
      type: 'string',
      enum: [...MODULE_ATTRIBUTION_MODES],
      default: 'defer',
      description:
        'What planning does when a change has no module owner yet: defer it to later, or stop.',
    },
  },
  {
    file: 'feature-development/checks.yaml',
    path: ['commands', 'from_project_profile'],
    schema: {
      ...STRING_LIST,
      description:
        'Command names from the project profile that the checks stage runs; [] runs none.',
    },
  },
  {
    file: 'feature-development/checks.yaml',
    path: ['commands', 'extra'],
    schema: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Extra shell commands the checks stage runs, by name.',
    },
  },
  {
    file: 'feature-development/checks.yaml',
    path: ['on_failure'],
    schema: {
      type: 'string',
      enum: [...CHECKS_ON_FAILURE_MODES],
      default: 'block',
      description: 'block stops the change when a check fails; warn records it and carries on.',
    },
  },
];
