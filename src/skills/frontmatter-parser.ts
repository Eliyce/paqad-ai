import YAML from 'yaml';

import { CLASSIFICATION_WORKFLOWS } from '@/core/types/classification.js';
import type {
  LoadedSkill,
  SkillCompletionTrigger,
  SkillDefinition,
  SkillInputSchema,
  SkillOutputFormat,
  SkillRequestRoutingRule,
} from '@/core/types/skill.js';
import { ValidationError } from '@/core/errors/index.js';
import { ConditionalSectionProcessor } from './conditional-processor.js';

const FRONTMATTER_BOUNDARY = '---';
const DEFAULT_MAX_LINES = 300;

export interface ParsedSkillDocument {
  frontmatter: SkillDefinition;
  body: string;
  line_count: number;
}

export class SkillFrontmatterParser {
  parse(content: string): ParsedSkillDocument {
    const lines = content.split(/\r?\n/);
    const lineCount = lines.length;

    if (lineCount > DEFAULT_MAX_LINES) {
      throw new ValidationError(`SKILL.md exceeds ${DEFAULT_MAX_LINES} lines`);
    }

    if (lines[0] !== FRONTMATTER_BOUNDARY) {
      throw new ValidationError('SKILL.md must start with YAML frontmatter');
    }

    const closingIndex = lines.indexOf(FRONTMATTER_BOUNDARY, 1);
    if (closingIndex === -1) {
      throw new ValidationError('SKILL.md frontmatter is missing a closing boundary');
    }

    const rawFrontmatter = lines.slice(1, closingIndex).join('\n');
    const parsed = YAML.parse(rawFrontmatter);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ValidationError('SKILL.md frontmatter must be a YAML object');
    }

    const frontmatter = normalizeDefinition(parsed as Record<string, unknown>);
    const body = lines
      .slice(closingIndex + 1)
      .join('\n')
      .trim();

    return {
      frontmatter,
      body,
      line_count: lineCount,
    };
  }
}

function normalizeDefinition(input: Record<string, unknown>): SkillDefinition {
  const name = asString(input.name, 'name');
  const description = asString(input.description, 'description');
  const modelTier = asModelTier(input.model_tier);
  const requestRouting =
    input.request_routing === undefined
      ? undefined
      : asRequestRouting(input.request_routing, 'request_routing');
  const triggers = asTriggers(input.triggers, requestRouting !== undefined);
  const cacheable = asBoolean(input.cacheable, 'cacheable');
  const cacheKeyInputs =
    input.cache_key_inputs === undefined
      ? []
      : asStringArray(input.cache_key_inputs, 'cache_key_inputs');
  const outputFormat = asOutputFormat(input.output_format);
  const inputSchema = asInputSchema(input.input_schema);
  const onComplete =
    input.on_complete === undefined
      ? undefined
      : asCompletionTrigger(input.on_complete, 'on_complete');
  const maxLines =
    input.max_lines === undefined
      ? DEFAULT_MAX_LINES
      : asPositiveInteger(input.max_lines, 'max_lines');
  const tools = input.tools === undefined ? undefined : asStringArray(input.tools, 'tools');
  const maxOutputTokens =
    input.max_output_tokens === undefined
      ? undefined
      : asPositiveInteger(input.max_output_tokens, 'max_output_tokens');

  return {
    name,
    description,
    file: '',
    model_tier: modelTier,
    triggers,
    request_routing: requestRouting,
    max_lines: maxLines,
    cacheable,
    cache_key_inputs: cacheKeyInputs,
    output_format: outputFormat,
    input_schema: inputSchema,
    on_complete: onComplete,
    tools,
    max_output_tokens: maxOutputTokens,
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be a non-empty string`);
  }

  return value.trim();
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be a boolean`);
  }

  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be an array of strings`);
  }

  return value.map((item) => item.trim());
}

function asPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be a positive integer`);
  }

  return value;
}

function asModelTier(value: unknown): SkillDefinition['model_tier'] {
  if (value === 'standard') {
    return 'medium';
  }

  if (value === 'deep') {
    return 'reasoning';
  }

  if (value === 'fast' || value === 'medium' || value === 'reasoning') {
    return value;
  }

  throw new ValidationError(
    'SKILL.md frontmatter field "model_tier" must be one of fast, medium, reasoning',
  );
}

function asTriggers(value: unknown, allowEmpty = false): SkillDefinition['triggers'] {
  if (value === undefined && allowEmpty) {
    return [];
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(
      'SKILL.md frontmatter field "triggers" must be a non-empty array unless "request_routing" is provided',
    );
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(
        'Each skill trigger must be an object of classification dimensions',
      );
    }

    const normalized: Record<string, string[]> = {};
    for (const [dimension, allowedValues] of Object.entries(entry)) {
      normalized[dimension] = asStringArray(allowedValues, `triggers.${dimension}`);
    }

    return normalized;
  });
}

function asRequestRouting(value: unknown, field: string): SkillRequestRoutingRule[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be a non-empty array`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(`SKILL.md frontmatter field "${field}.${index}" must be an object`);
    }

    const typedEntry = entry as Record<string, unknown>;

    return {
      priority: asPositiveInteger(typedEntry.priority, `${field}.${index}.priority`),
      patterns: asStringArray(typedEntry.patterns, `${field}.${index}.patterns`),
      target_workflow: asWorkflowTarget(
        typedEntry.target_workflow,
        `${field}.${index}.target_workflow`,
      ),
    };
  });
}

function asWorkflowTarget(value: unknown, field: string): string {
  const target = asString(value, field);

  if (CLASSIFICATION_WORKFLOWS.includes(target as (typeof CLASSIFICATION_WORKFLOWS)[number])) {
    return target;
  }

  if (target.startsWith('custom:') && target.slice('custom:'.length).trim() !== '') {
    return target;
  }

  throw new ValidationError(
    `SKILL.md frontmatter field "${field}" must be a known workflow or custom:<template-name>`,
  );
}

function asOutputFormat(value: unknown): SkillOutputFormat {
  if (value === 'markdown' || value === 'yaml' || value === 'json') {
    return value;
  }

  throw new ValidationError(
    'SKILL.md frontmatter field "output_format" must be one of markdown, yaml, json',
  );
}

function asInputSchema(value: unknown): SkillInputSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('SKILL.md frontmatter field "input_schema" must be an object');
  }

  const schema: SkillInputSchema = {};

  for (const [name, field] of Object.entries(value)) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new ValidationError(
        `SKILL.md frontmatter field "input_schema.${name}" must be an object`,
      );
    }

    const typedField = field as Record<string, unknown>;
    const type = typedField.type;
    if (
      type !== 'string' &&
      type !== 'string[]' &&
      type !== 'boolean' &&
      type !== 'path' &&
      type !== 'path[]' &&
      type !== 'object'
    ) {
      throw new ValidationError(
        `SKILL.md frontmatter field "input_schema.${name}.type" must be one of string, string[], boolean, path, path[], object`,
      );
    }

    schema[name] = {
      type,
      required: asBoolean(typedField.required, `input_schema.${name}.required`),
      description:
        typedField.description === undefined
          ? undefined
          : asString(typedField.description, `input_schema.${name}.description`),
    };
  }

  if (Object.keys(schema).length === 0) {
    throw new ValidationError(
      'SKILL.md frontmatter field "input_schema" must define at least one input',
    );
  }

  return schema;
}

function asCompletionTrigger(value: unknown, field: string): SkillCompletionTrigger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`SKILL.md frontmatter field "${field}" must be an object`);
  }

  const typedValue = value as Record<string, unknown>;

  return {
    emit: asString(typedValue.emit, `${field}.emit`),
    triggers: asStringArray(typedValue.triggers, `${field}.triggers`),
  };
}

const conditionalProcessor = new ConditionalSectionProcessor();

export function toLoadedSkill(
  file: string,
  parsed: ParsedSkillDocument,
  frameworks?: string[],
): LoadedSkill {
  const body =
    frameworks && frameworks.length > 0
      ? conditionalProcessor.process(parsed.body, frameworks)
      : parsed.body;

  return {
    ...parsed.frontmatter,
    file,
    body,
    line_count: parsed.line_count,
  };
}
