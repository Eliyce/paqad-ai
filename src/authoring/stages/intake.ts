import YAML from 'yaml';

import { option, raiseAuthoringDecision } from '../decisions.js';
import {
  AuthoringRefusal,
  clearWaiting,
  requireEarlierGates,
  setWaiting,
  type SkillWorkspace,
} from '../workspace.js';
import { stageResult, type StageResult } from './result.js';

export const INTAKE_FIELDS = [
  'purpose',
  'triggers',
  'output_format',
  'verifiability',
  'skill_class',
  'scope',
  'dependencies',
] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];

export const VERIFIABILITY = ['objective', 'subjective'] as const;
export const SKILL_CLASSES = [
  'discipline',
  'technique',
  'pattern',
  'reference',
  'workflow',
] as const;
export type SkillClass = (typeof SKILL_CLASSES)[number];

export const S5_TEST_TYPE: Record<SkillClass, string> = {
  discipline: 'pressure scenarios',
  technique: 'application and missing-information tests',
  pattern: 'recognition and counter-examples',
  reference: 'retrieval and gap tests',
  workflow: 'an end-to-end run with checklist completion',
};

export interface Intake {
  purpose: string;
  triggers: string[];
  output_format: string;
  verifiability: (typeof VERIFIABILITY)[number];
  skill_class: SkillClass;
  scope: { in: string[]; out: string[] };
  dependencies: string[];
}

function filledText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function filledList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(filledText);
}

function fieldFilled(field: IntakeField, record: Record<string, unknown>): boolean {
  const value = record[field];
  switch (field) {
    case 'triggers':
    case 'dependencies':
      return filledList(value);
    case 'scope': {
      const scope = value as { in?: unknown; out?: unknown } | null;
      return typeof scope === 'object' && scope !== null && filledList(scope.in);
    }
    default:
      return filledText(value);
  }
}

export function emptyIntakeFields(record: Record<string, unknown>): IntakeField[] {
  return INTAKE_FIELDS.filter((field) => !fieldFilled(field, record));
}

export function parseIntake(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new AuthoringRefusal(`intake.yaml is not valid YAML: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export function readWorkspaceIntake(workspace: SkillWorkspace): Intake | null {
  const text = workspace.read('intake.yaml');
  return text === null ? null : (parseIntake(text) as unknown as Intake);
}

export function runIntake(workspace: SkillWorkspace, intakeText: string): StageResult {
  requireEarlierGates(workspace, 'S1');
  const record = parseIntake(intakeText);
  const empty = emptyIntakeFields(record);
  if (empty.length > 0) {
    throw new AuthoringRefusal(
      `S1 intake failed: these fields are empty: ${empty.join(', ')}. Fill them from the spec, the ticket, ` +
        'the trace and the project documents; raise authoring.intake_gap only for a field none of them answer.',
    );
  }
  const invalid: string[] = [];
  if (!(VERIFIABILITY as readonly unknown[]).includes(record.verifiability)) {
    invalid.push(`verifiability must be ${VERIFIABILITY.join(' or ')}`);
  }
  if (!(SKILL_CLASSES as readonly unknown[]).includes(record.skill_class)) {
    invalid.push(`skill_class must be one of ${SKILL_CLASSES.join(', ')}`);
  }
  if (invalid.length > 0) {
    throw new AuthoringRefusal(`S1 intake failed: ${invalid.join('; ')}.`);
  }
  const intake = record as unknown as Intake;
  const artifact = workspace.write('intake.yaml', YAML.stringify(intake));
  clearWaiting(workspace, 'S1');
  return stageResult(
    true,
    [
      `S1 intake passed: all ${INTAKE_FIELDS.length} fields are filled. S5 will use ${S5_TEST_TYPE[intake.skill_class]}.`,
      `Next: paqad-ai skill evidence ${workspace.name} <sources.md>`,
    ],
    [artifact],
  );
}

export interface IntakeGapInput {
  field: string;
  question: string;
  options: string[];
  recommend: string;
  change?: string | null;
}

export function raiseIntakeGap(workspace: SkillWorkspace, input: IntakeGapInput): StageResult {
  requireEarlierGates(workspace, 'S1');
  if (!(INTAKE_FIELDS as readonly string[]).includes(input.field)) {
    throw new AuthoringRefusal(`--gap must name an intake field: ${INTAKE_FIELDS.join(', ')}.`, 2);
  }
  if (input.options.length < 2 || input.options.length > 4) {
    throw new AuthoringRefusal('an intake gap needs 2 to 4 --option values.', 2);
  }
  const keys = input.options.map((_, index) => `option-${index + 1}`);
  const recommended = input.options.indexOf(input.recommend);
  if (recommended === -1) {
    throw new AuthoringRefusal('--recommend must repeat one of the --option values.', 2);
  }
  const id = raiseAuthoringDecision(workspace.projectRoot, {
    category: 'authoring.intake_gap',
    title: input.question,
    context:
      `The skill ${workspace.name} needs its ${input.field} field, and the spec, the ticket, the trace ` +
      'and the project documents do not answer it.',
    options: input.options.map((label, index) =>
      option(
        keys[index]!,
        label,
        `If you pick this, the ${input.field} field reads: ${label}.`,
        'You give up: the other options.',
      ),
    ),
    recommendation: keys[recommended]!,
    change: input.change,
  });
  const resume = `paqad-ai skill intake ${workspace.name} <intake.yaml>`;
  setWaiting(workspace, { stage: 'S1', decision: id, resume });
  return {
    ok: false,
    decision: id,
    artifacts: [],
    lines: [
      `S1 intake is waiting on decision ${id} for the ${input.field} field. Once it is answered, run ${resume}.`,
    ],
  };
}
