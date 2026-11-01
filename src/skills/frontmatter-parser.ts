import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, sep } from 'node:path';

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

export const SKILL_META_KEY = 'paqad-meta';
export const SKILL_META_FILE = 'skill.meta.yaml';
export const SKILL_METADATA_STRING_KEYS: readonly string[] = [
  'model_tier',
  'cacheable',
  'output_format',
  'max_lines',
  'max_output_tokens',
];
export const SKILL_META_FILE_KEYS: readonly string[] = [
  'triggers',
  'input_schema',
  'cache_key_inputs',
  'request_routing',
  'on_complete',
  'tools',
];
export const SKILL_CUSTOM_KEYS: readonly string[] = [
  ...SKILL_METADATA_STRING_KEYS,
  ...SKILL_META_FILE_KEYS,
];

const recordedDeprecations = new Set<string>();

export function skillMetadataDeprecations(): string[] {
  return [...recordedDeprecations];
}

export function clearSkillMetadataDeprecations(): void {
  recordedDeprecations.clear();
}

export interface ParsedSkillDocument {
  frontmatter: SkillDefinition;
  body: string;
  line_count: number;
}

export type SplitSkillFrontmatter =
  | {
      ok: true;
      data: Record<string, unknown>;
      frontmatterLines: string[];
      body: string;
      bodyStartLine: number;
    }
  | { ok: false; code: string; message: string };

export function splitSkillFrontmatter(content: string): SplitSkillFrontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== FRONTMATTER_BOUNDARY) {
    return {
      ok: false,
      code: 'SKILL_BOUNDARY_MISSING',
      message: 'SKILL.md must start with YAML frontmatter',
    };
  }
  const closingIndex = lines.indexOf(FRONTMATTER_BOUNDARY, 1);
  if (closingIndex === -1) {
    return {
      ok: false,
      code: 'SKILL_BOUNDARY_UNCLOSED',
      message: 'SKILL.md frontmatter is missing a closing boundary',
    };
  }
  const frontmatterLines = lines.slice(1, closingIndex);
  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatterLines.join('\n'));
  } catch (error) {
    return {
      ok: false,
      code: 'SKILL_FRONTMATTER_INVALID_YAML',
      message: `SKILL.md frontmatter is not valid YAML: ${(error as Error).message}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'SKILL_FRONTMATTER_NOT_OBJECT',
      message: 'SKILL.md frontmatter must be a YAML object',
    };
  }
  return {
    ok: true,
    data: parsed as Record<string, unknown>,
    frontmatterLines,
    body: lines.slice(closingIndex + 1).join('\n'),
    bodyStartLine: closingIndex + 2,
  };
}

function metaError(skill: string, message: string, field = SKILL_META_KEY): ValidationError {
  return new ValidationError(
    `Skill "${skill}": ${message}`,
    undefined,
    `SKILL_FIELD_INVALID:metadata.${field}`,
  );
}

function readMetaFile(
  skill: string,
  folder: string | undefined,
  ref: unknown,
): Record<string, unknown> {
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw metaError(skill, `metadata.${SKILL_META_KEY} must name a file in the skill folder.`);
  }
  if (isAbsolute(ref) || ref.startsWith('/') || ref.split(/[\\/]/u).includes('..')) {
    throw metaError(
      skill,
      `metadata.${SKILL_META_KEY} "${ref}" must be a path inside the skill folder (no absolute path, no "..").`,
    );
  }
  if (folder === undefined) {
    throw metaError(
      skill,
      `metadata.${SKILL_META_KEY} "${ref}" needs the skill folder to be read.`,
    );
  }
  const path = join(folder, ref);
  let text: string;
  try {
    const base = realpathSync(folder);
    if (lstatSync(path).isSymbolicLink() && !realpathSync(path).startsWith(`${base}${sep}`)) {
      throw metaError(skill, `${ref} is a symlink that leads outside the skill folder.`);
    }
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw metaError(skill, `${ref} named by metadata.${SKILL_META_KEY} is missing.`);
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw metaError(skill, `${ref} is not valid YAML: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw metaError(skill, `${ref} must be a YAML object.`);
  }
  return parsed as Record<string, unknown>;
}

function coerceMetadataString(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'cacheable') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (key === 'max_lines' || key === 'max_output_tokens') {
    return /^\d+$/u.test(value.trim()) ? Number(value.trim()) : value;
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordDeprecation(skill: string, key: string, disagrees: boolean): void {
  recordedDeprecations.add(
    disagrees
      ? `Skill "${skill}": top-level "${key}" disagrees with its metadata value; the metadata value wins. Remove the top-level key.`
      : `Skill "${skill}": top-level "${key}" is deprecated; move it under metadata (or ${SKILL_META_FILE}) before the fallback is removed.`,
  );
}

export function resolveSkillMetadata(
  data: Record<string, unknown>,
  folder?: string,
): Record<string, unknown> {
  const skill =
    typeof data.name === 'string' && data.name.trim() !== ''
      ? data.name.trim()
      : folder
        ? basename(folder)
        : 'unknown';
  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};
  const sidecar =
    metadata[SKILL_META_KEY] === undefined
      ? {}
      : readMetaFile(skill, folder, metadata[SKILL_META_KEY]);
  const resolved: Record<string, unknown> = { ...data };
  const fresh: Record<string, unknown> = {};
  for (const key of SKILL_METADATA_STRING_KEYS) {
    if (metadata[key] !== undefined) fresh[key] = coerceMetadataString(key, metadata[key]);
  }
  for (const key of SKILL_META_FILE_KEYS) {
    if (sidecar[key] !== undefined) fresh[key] = sidecar[key];
  }
  for (const key of SKILL_CUSTOM_KEYS) {
    const old = data[key];
    if (old !== undefined) recordDeprecation(skill, key, key in fresh && !same(old, fresh[key]));
    if (key in fresh) resolved[key] = fresh[key];
  }
  return resolved;
}

export function skillDeclaresRequestRouting(content: string, folder?: string): boolean {
  const split = splitSkillFrontmatter(content);
  if (!split.ok) return false;
  if (split.data.request_routing !== undefined) return true;
  const metadata = split.data.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object' || metadata[SKILL_META_KEY] === undefined) {
    return false;
  }
  try {
    return resolveSkillMetadata(split.data, folder).request_routing !== undefined;
  } catch {
    return true;
  }
}

export class SkillFrontmatterParser {
  parse(content: string, folder?: string): ParsedSkillDocument {
    const lines = content.split(/\r?\n/);
    const lineCount = lines.length;

    if (lineCount > DEFAULT_MAX_LINES) {
      throw new ValidationError(
        `SKILL.md exceeds ${DEFAULT_MAX_LINES} lines`,
        undefined,
        'SKILL_LINE_LIMIT_EXCEEDED',
      );
    }

    const split = splitSkillFrontmatter(content);
    if (!split.ok) {
      throw new ValidationError(split.message, undefined, split.code);
    }

    const frontmatter = normalizeDefinition(resolveSkillMetadata(split.data, folder));
    const body = split.body.trim();

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

function fieldInvalidCode(field: string): string {
  return `SKILL_FIELD_INVALID:${field}`;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be a non-empty string`,
      undefined,
      fieldInvalidCode(field),
    );
  }

  return value.trim();
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be a boolean`,
      undefined,
      fieldInvalidCode(field),
    );
  }

  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be an array of strings`,
      undefined,
      fieldInvalidCode(field),
    );
  }

  return value.map((item) => item.trim());
}

function asPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be a positive integer`,
      undefined,
      fieldInvalidCode(field),
    );
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
    undefined,
    fieldInvalidCode('model_tier'),
  );
}

function asTriggers(value: unknown, allowEmpty = false): SkillDefinition['triggers'] {
  if (value === undefined && allowEmpty) {
    return [];
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(
      'SKILL.md frontmatter field "triggers" must be a non-empty array unless "request_routing" is provided',
      undefined,
      fieldInvalidCode('triggers'),
    );
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(
        'Each skill trigger must be an object of classification dimensions',
        undefined,
        fieldInvalidCode('triggers'),
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
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be a non-empty array`,
      undefined,
      fieldInvalidCode(field),
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(
        `SKILL.md frontmatter field "${field}.${index}" must be an object`,
        undefined,
        fieldInvalidCode(`${field}.${index}`),
      );
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
    undefined,
    fieldInvalidCode(field),
  );
}

function asOutputFormat(value: unknown): SkillOutputFormat {
  if (value === 'markdown' || value === 'yaml' || value === 'json') {
    return value;
  }

  throw new ValidationError(
    'SKILL.md frontmatter field "output_format" must be one of markdown, yaml, json',
    undefined,
    fieldInvalidCode('output_format'),
  );
}

function asInputSchema(value: unknown): SkillInputSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      'SKILL.md frontmatter field "input_schema" must be an object',
      undefined,
      fieldInvalidCode('input_schema'),
    );
  }

  const schema: SkillInputSchema = {};

  for (const [name, field] of Object.entries(value)) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new ValidationError(
        `SKILL.md frontmatter field "input_schema.${name}" must be an object`,
        undefined,
        fieldInvalidCode(`input_schema.${name}`),
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
        undefined,
        fieldInvalidCode(`input_schema.${name}.type`),
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
      undefined,
      fieldInvalidCode('input_schema'),
    );
  }

  return schema;
}

function asCompletionTrigger(value: unknown, field: string): SkillCompletionTrigger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `SKILL.md frontmatter field "${field}" must be an object`,
      undefined,
      fieldInvalidCode(field),
    );
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
