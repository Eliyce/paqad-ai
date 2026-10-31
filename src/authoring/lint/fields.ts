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

export function allowedSkillFields(claudeCode: boolean): ReadonlySet<string> {
  return new Set<string>(
    claudeCode
      ? [...OPEN_SPEC_SKILL_FIELDS, ...CLAUDE_CODE_SKILL_FIELDS.fields]
      : OPEN_SPEC_SKILL_FIELDS,
  );
}
