import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { FRAMEWORK_CONFIG_SPECS, type FrameworkConfigSpec } from './framework-config.js';
import {
  TEAM_CONFIG_FILE_DESCRIPTIONS,
  TEAM_CONFIG_FILES,
  yamlDefault,
  yamlEnumOf,
  type OwnTeamConfigFile,
} from './team-config-values.js';

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

export function registrySettingSchema(spec: FrameworkConfigSpec): JsonSchema {
  const def = yamlDefault(spec);
  const base: JsonSchema = { description: spec.comment };
  if (def !== undefined) base.default = def;
  if (spec.yaml?.list) return { ...base, ...STRING_LIST };
  if (spec.yaml?.zeroIsAuto) {
    return { ...base, anyOf: [{ type: 'number' }, { type: 'string', enum: ['auto'] }] };
  }
  const allowed = yamlEnumOf(spec);
  if (allowed !== undefined) return { ...base, type: 'string', enum: [...allowed] };
  if (spec.type === 'boolean') return { ...base, type: 'boolean' };
  if (spec.type === 'number') return { ...base, type: 'number' };
  return { ...base, type: 'string' };
}

function objectNode(): JsonSchema {
  return { type: 'object', properties: {}, additionalProperties: true };
}

function placeAt(root: JsonSchema, path: readonly string[], leaf: JsonSchema): void {
  let node = root;
  for (const segment of path.slice(0, -1)) {
    const properties = node.properties as Record<string, JsonSchema>;
    properties[segment] ??= objectNode();
    node = properties[segment]!;
  }
  (node.properties as Record<string, JsonSchema>)[path[path.length - 1]!] = leaf;
}

export function generateTeamConfigSchema(file: OwnTeamConfigFile): JsonSchema {
  const root: JsonSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `.paqad/configs/${file}`,
    description: TEAM_CONFIG_FILE_DESCRIPTIONS[file],
    ...objectNode(),
  };
  placeAt(root, ['paqad_version'], {
    type: 'string',
    description: 'The paqad version that last wrote this file.',
  });
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    if (spec.file === file) placeAt(root, spec.path, registrySettingSchema(spec));
  }
  for (const setting of STRUCTURED_TEAM_SETTINGS) {
    if (setting.file === file) placeAt(root, setting.path, setting.schema);
  }
  return root;
}

export function teamConfigSchemaPath(projectRoot: string, file: OwnTeamConfigFile): string {
  return join(
    projectRoot,
    PATHS.PROJECT_CONFIG_SCHEMAS_DIR,
    file.replace(/\.yaml$/u, '.schema.json'),
  );
}

export function writeTeamConfigSchemas(projectRoot: string): string[] {
  return TEAM_CONFIG_FILES.map((file) => {
    const path = teamConfigSchemaPath(projectRoot, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(generateTeamConfigSchema(file), null, 2)}\n`, 'utf8');
    return path;
  });
}
