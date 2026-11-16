import { STAGE_IDS, type StageDefinition, type StageId } from './types.js';

export const ONBOARDING_STAGES: readonly StageDefinition[] = [
  {
    id: 'detect',
    index: 1,
    name: 'Read your project',
    label: 'Read',
    running: 'Reading your project',
    workflow: 'detect',
    runs_in: 'cli',
    agent: null,
    unit: null,
    allowed_degraded: ['stack_mismatch_noted'],
  },
  {
    id: 'setup',
    index: 2,
    name: 'Set up paqad',
    label: 'Set up',
    running: 'Setting up paqad',
    workflow: 'onboard setup',
    runs_in: 'cli',
    agent: null,
    unit: null,
    allowed_degraded: ['git_workflow_kept'],
  },
  {
    id: 'project_docs',
    index: 3,
    name: 'Write the project docs',
    label: 'Docs',
    running: 'Writing the project docs',
    workflow: 'documentation-update',
    runs_in: 'agent',
    agent: 'paqad-onboarding-docs',
    unit: { one: 'doc area', many: 'doc areas' },
    allowed_degraded: [],
  },
  {
    id: 'module_docs',
    index: 4,
    name: 'Write the module docs',
    label: 'Modules',
    running: 'Writing the module docs',
    workflow: 'module-documentation',
    runs_in: 'agent',
    agent: 'paqad-onboarding-modules',
    unit: { one: 'module', many: 'modules' },
    allowed_degraded: [],
  },
  {
    id: 'rules_discovery',
    index: 5,
    name: 'Research rules for your stack',
    label: 'Research',
    running: 'Researching rules for your stack',
    workflow: 'rules-discovery',
    runs_in: 'agent',
    agent: 'paqad-onboarding-rules',
    unit: { one: 'package', many: 'packages' },
    allowed_degraded: ['research_offline', 'research_stopped'],
  },
  {
    id: 'rules_analyze',
    index: 6,
    name: 'Check which rules can be automated',
    label: 'Triage',
    running: 'Checking which rules can be automated',
    workflow: 'rules-analyze',
    runs_in: 'agent',
    agent: 'paqad-onboarding-analyze',
    unit: { one: 'rule batch', many: 'rule batches' },
    allowed_degraded: [],
  },
  {
    id: 'rule_scripts',
    index: 7,
    name: 'Write the rule checks',
    label: 'Checks',
    running: 'Writing the rule checks',
    workflow: 'rules-generate',
    runs_in: 'agent',
    agent: 'paqad-onboarding-scripts',
    unit: { one: 'rule batch', many: 'rule batches' },
    allowed_degraded: [],
  },
  {
    id: 'finish',
    index: 8,
    name: 'Wrap up',
    label: 'Wrap up',
    running: 'Wrapping up',
    workflow: 'search index, report, commit question',
    runs_in: 'cli',
    agent: null,
    unit: null,
    allowed_degraded: ['rag_off'],
  },
];

export const STAGE_COUNT = ONBOARDING_STAGES.length;

export const PROJECT_DOC_AREAS = [
  'stack',
  'architecture',
  'design-system',
  'registries',
  'benchmarks',
  'tech-debt',
  'module-map',
] as const;

export const MODULE_REGISTRIES_UNIT = 'registries';

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

export function stageDefinition(id: StageId): StageDefinition {
  const found = ONBOARDING_STAGES.find((stage) => stage.id === id);
  if (!found) throw new Error(`Unknown onboarding stage: ${id}`);
  return found;
}

export function stagesBefore(id: StageId): StageDefinition[] {
  const index = stageDefinition(id).index;
  return ONBOARDING_STAGES.filter((stage) => stage.index < index);
}

export function nextStage(id: StageId): StageDefinition | null {
  const index = stageDefinition(id).index;
  return ONBOARDING_STAGES.find((stage) => stage.index === index + 1) ?? null;
}

export function statusLine(id: StageId, detail?: string): string {
  const stage = stageDefinition(id);
  const parts = [`Step ${stage.index} of ${STAGE_COUNT}`, stage.running];
  if (detail) parts.push(detail);
  return `**▸ paqad** · ${parts.join(' · ')}`;
}
