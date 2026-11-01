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

// paqad's runtime keys (model_tier, triggers, input_schema and the rest) live under
// `metadata` and in `skill.meta.yaml`, so a paqad skill gets no extra top-level field:
// a new top-level custom key blocks under SK-006. Users' skills that still carry the old
// keys are read by the parser fallback (src/skills/frontmatter-parser.ts) for one minor.
export const PAQAD_RUNTIME_SKILL_FIELDS: readonly string[] = [];

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

export const CLAUDE_CODE_AGENT_FIELDS = {
  checked: '2026-11-01',
  source: 'https://code.claude.com/docs/en/sub-agents',
  fields: [
    'name',
    'description',
    'tools',
    'disallowedTools',
    'model',
    'permissionMode',
    'maxTurns',
    'autoCompactWindow',
    'skills',
    'mcpServers',
    'hooks',
    'memory',
    'background',
    'omitClaudeMd',
    'effort',
    'isolation',
    'color',
    'initialPrompt',
    'experimental',
  ],
  plugin_ignored_fields: ['permissionMode', 'mcpServers', 'hooks', 'initialPrompt'],
  tools: [
    'Agent',
    'Artifact',
    'AskUserQuestion',
    'Bash',
    'Edit',
    'EndConversation',
    'EnterPlanMode',
    'EnterWorktree',
    'ExitPlanMode',
    'ExitWorktree',
    'Glob',
    'Grep',
    'LSP',
    'Monitor',
    'NotebookEdit',
    'PowerShell',
    'Read',
    'ScheduleWakeup',
    'SendMessage',
    'Skill',
    'SubagentHandback',
    'Task',
    'TaskStop',
    'TodoWrite',
    'ToolSearch',
    'WaitForMcpServers',
    'WebFetch',
    'WebSearch',
    'Workflow',
    'Write',
  ],
  models: ['inherit', 'haiku', 'sonnet', 'opus', 'fable'],
  model_id_pattern: /^claude-[a-z0-9][a-z0-9.-]*$/u,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  memory_scopes: ['user', 'project', 'local'],
  isolation: ['worktree'],
  cache_ttls: ['5m', '1h'],
  permission_modes: [
    'default',
    'manual',
    'acceptEdits',
    'auto',
    'dontAsk',
    'bypassPermissions',
    'plan',
  ],
} as const;

export const CODEX_AGENT_FIELDS = {
  checked: '2026-11-01',
  source: 'https://developers.openai.com/codex/subagents',
  fields: ['name', 'description', 'developer_instructions', 'model', 'model_reasoning_effort'],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
} as const;

export function isClaudeModel(model: string): boolean {
  return (
    (CLAUDE_CODE_AGENT_FIELDS.models as readonly string[]).includes(model) ||
    CLAUDE_CODE_AGENT_FIELDS.model_id_pattern.test(model)
  );
}

export const AGENT_ROLE_NOUNS: readonly string[] = [
  'agent',
  'analyst',
  'architect',
  'assistant',
  'coach',
  'critic',
  'expert',
  'guard',
  'judge',
  'scout',
  'sentinel',
  'specialist',
];

export function isObjectRoleName(name: string): boolean {
  const last = name.split('-').at(-1) ?? '';
  return /(?:er|or|ist|ian)$/u.test(last) || AGENT_ROLE_NOUNS.includes(last);
}
