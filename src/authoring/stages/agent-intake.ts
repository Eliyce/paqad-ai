import YAML from 'yaml';

import {
  AuthoringRefusal,
  clearWaiting,
  requireEarlierGates,
  type AuthoringWorkspace,
} from '../workspace.js';
import { parseIntake } from './intake.js';
import { stageResult, type StageResult } from './result.js';

export const AGENT_INTAKE_FIELDS = [
  'job',
  'delegation_brief',
  'report',
  'tools',
  'model_tier',
  'effort',
  'stopping',
  'memory',
  'isolation',
  'parallel',
  'cache_ttl',
  'class',
  'invocation',
  'pattern',
] as const;
export type AgentIntakeField = (typeof AGENT_INTAKE_FIELDS)[number];

export const MODEL_TIERS = ['fast', 'reasoning'] as const;
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'inherit'] as const;
export const AGENT_MEMORY = ['none', 'candidate'] as const;
export const AGENT_ISOLATION = ['none', 'worktree'] as const;
export const CACHE_TTLS = ['5m', '1h'] as const;
export const AGENT_CLASSES = ['explorer', 'reviewer', 'builder', 'verifier', 'specialist'] as const;
export const AGENT_INVOCATIONS = ['auto', 'dispatched'] as const;
export const AGENT_PATTERNS = [
  'single-call',
  'chaining',
  'routing',
  'parallel-sections',
  'orchestrator-workers',
  'evaluator-optimizer',
  'autonomous-loop',
] as const;
export type AgentClass = (typeof AGENT_CLASSES)[number];

export const AGENT_S5_TASK_TYPE: Record<AgentClass, string> = {
  explorer: 'cases where it must name the right files',
  reviewer: 'planted defects it must catch and a clean input it must stay silent on',
  builder: "cases that must leave the project's tests green",
  verifier: 'a planted regression it must catch',
  specialist: "questions it must answer from the project's facts",
};

export interface AgentIntake {
  job: string;
  delegation_brief: string;
  report: { template: string; max_tokens: number };
  tools: string[];
  model_tier: (typeof MODEL_TIERS)[number];
  effort: (typeof AGENT_EFFORTS)[number];
  stopping: { max_turns: number; done_when: string; when_blocked: string };
  memory: (typeof AGENT_MEMORY)[number];
  isolation: (typeof AGENT_ISOLATION)[number];
  parallel: boolean;
  cache_ttl: (typeof CACHE_TTLS)[number];
  class: AgentClass;
  invocation: (typeof AGENT_INVOCATIONS)[number];
  pattern: (typeof AGENT_PATTERNS)[number];
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldFilled(field: AgentIntakeField, record: Record<string, unknown>): boolean {
  const value = record[field];
  switch (field) {
    case 'report': {
      const report = object(value);
      return report !== null && text(report.template) && count(report.max_tokens);
    }
    case 'tools':
      return Array.isArray(value) && value.length > 0 && value.every(text);
    case 'stopping': {
      const stopping = object(value);
      return (
        stopping !== null &&
        count(stopping.max_turns) &&
        text(stopping.done_when) &&
        text(stopping.when_blocked)
      );
    }
    case 'parallel':
      return typeof value === 'boolean';
    default:
      return text(value);
  }
}

export function emptyAgentIntakeFields(record: Record<string, unknown>): AgentIntakeField[] {
  return AGENT_INTAKE_FIELDS.filter((field) => !fieldFilled(field, record));
}

const ENUMERATIONS: readonly [AgentIntakeField, readonly string[]][] = [
  ['model_tier', MODEL_TIERS],
  ['effort', AGENT_EFFORTS],
  ['memory', AGENT_MEMORY],
  ['isolation', AGENT_ISOLATION],
  ['cache_ttl', CACHE_TTLS],
  ['class', AGENT_CLASSES],
  ['invocation', AGENT_INVOCATIONS],
  ['pattern', AGENT_PATTERNS],
];

export function invalidAgentIntakeFields(record: Record<string, unknown>): string[] {
  return ENUMERATIONS.filter(([field, allowed]) => !allowed.includes(record[field] as string)).map(
    ([field, allowed]) => `${field} must be one of ${allowed.join(', ')}`,
  );
}

export function readAgentIntake(workspace: AuthoringWorkspace): AgentIntake | null {
  const raw = workspace.read('intake.yaml');
  return raw === null ? null : (parseIntake(raw) as unknown as AgentIntake);
}

export function hasMemoryArm(intake: Pick<AgentIntake, 'memory'>): boolean {
  return intake.memory === 'candidate';
}

export function runAgentIntake(workspace: AuthoringWorkspace, intakeText: string): StageResult {
  requireEarlierGates(workspace, 'S1');
  const record = parseIntake(intakeText);
  const empty = emptyAgentIntakeFields(record);
  if (empty.length > 0) {
    throw new AuthoringRefusal(
      `S1 intake failed: these fields are empty: ${empty.join(', ')}. Fill them from the spec, the ticket, ` +
        'the justification and the project documents; raise authoring.intake_gap only for a business ' +
        'question none of them answer.',
    );
  }
  const invalid = invalidAgentIntakeFields(record);
  if (invalid.length > 0) {
    throw new AuthoringRefusal(`S1 intake failed: ${invalid.join('; ')}.`);
  }
  const intake = record as unknown as AgentIntake;
  const artifact = workspace.write('intake.yaml', YAML.stringify(intake));
  clearWaiting(workspace, 'S1');
  const memory = hasMemoryArm(intake)
    ? 'memory is a candidate, so S5 adds a with_agent_memory arm'
    : 'memory is none, so S5 runs no memory arm';
  return stageResult(
    true,
    [
      `S1 intake passed: all ${AGENT_INTAKE_FIELDS.length} fields are filled. S5 will use ${AGENT_S5_TASK_TYPE[intake.class]}; ${memory}.`,
      `Next: paqad-ai agent evidence ${workspace.name} <sources.md>`,
    ],
    [artifact],
  );
}
