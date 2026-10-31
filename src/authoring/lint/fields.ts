export const OPEN_SPEC_SKILL_FIELDS: readonly string[] = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
];

export const CLAUDE_CODE_SKILL_FIELDS = {
  checked: '2026-10-31',
  source: 'https://code.claude.com/docs/en/skills',
  fields: [
    'name',
    'description',
    'when_to_use',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
    'disallowed-tools',
    'disable-model-invocation',
    'user-invocable',
    'argument-hint',
    'model',
    'effort',
    'context',
    'agent',
    'hooks',
    'paths',
    'shell',
    'version',
    'arguments',
  ],
} as const;

export const FIELDS_MAX_AGE_DAYS = 60;

export const DESCRIPTION_MAX_CHARS = 1024;

export function descriptionLength(description: string): number {
  return [...description].length;
}

export function descriptionWithinLimit(description: string): boolean {
  return descriptionLength(description) <= DESCRIPTION_MAX_CHARS;
}

export const PAQAD_RUNTIME_SKILL_FIELDS: readonly string[] = [
  'name',
  'description',
  'model_tier',
  'triggers',
  'request_routing',
  'cacheable',
  'cache_key_inputs',
  'output_format',
  'input_schema',
  'on_complete',
  'max_lines',
  'tools',
  'max_output_tokens',
];

export function allowedSkillFields(claudeCode: boolean, paqadRuntime = false): ReadonlySet<string> {
  return new Set<string>([
    ...OPEN_SPEC_SKILL_FIELDS,
    ...(claudeCode ? CLAUDE_CODE_SKILL_FIELDS.fields : []),
    ...(paqadRuntime ? PAQAD_RUNTIME_SKILL_FIELDS : []),
  ]);
}

export const CLAUDE_PLUGIN_EVAL_SUPPORT = {
  checked: '2026-10-31',
  source: 'https://code.claude.com/docs/en/plugin-evals',
  minimum_version: '2.1.269',
  flags_checked_against: '2.1.302',
} as const;
