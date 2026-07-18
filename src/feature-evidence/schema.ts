// AJV schemas for the per-feature `feature.json` / `plan.json` records (issue
// #339, Phase 1). Framework-owned, in src/ (never under .paqad/), so the LLM can
// never weaken them. `additionalProperties:false` everywhere — an unknown key is
// rejected, which is what makes the stored bytes script-owned rather than a
// hallucination surface. Mirrors `src/stage-evidence/schema.ts`.

import Ajv, { type ValidateFunction } from 'ajv';

import { FEATURE_DOC_TYPE, PLAN_DOC_TYPE, REVIEW_DOC_TYPE } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;
const lane = { type: ['string', 'null'], enum: ['fast', 'graduated', 'full', null] } as const;

export const FEATURE_SCHEMA = {
  $id: 'paqad://schemas/feature.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'issue',
    'title',
    'slug',
    'ulid',
    'created_at',
    'updated_at',
    'lane',
    'status',
    'spec_id',
    'session_first_seen',
    'adapter',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: FEATURE_DOC_TYPE },
    issue: nullableString,
    title: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    ulid: { type: 'string', minLength: 1 },
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    lane,
    status: { enum: ['active', 'paused', 'done'] },
    spec_id: nullableString,
    session_first_seen: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

export const PLAN_SCHEMA = {
  $id: 'paqad://schemas/plan.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'issue',
    'title',
    'slug',
    'ulid',
    'summary',
    'steps',
    'modules_touched',
    'decisions',
    'risks',
    'created_at',
    'updated_at',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: PLAN_DOC_TYPE },
    issue: nullableString,
    title: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    ulid: { type: 'string', minLength: 1 },
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'description'],
        properties: {
          id: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          module: { type: 'string', minLength: 1 },
        },
      },
    },
    modules_touched: { type: 'array', items: { type: 'string', minLength: 1 } },
    decisions: { type: 'array', items: { type: 'string', minLength: 1 } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'mitigation'],
        properties: {
          description: { type: 'string', minLength: 1 },
          mitigation: { type: 'string', minLength: 1 },
        },
      },
    },
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

export const REVIEW_SCHEMA = {
  $id: 'paqad://schemas/review.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'issue',
    'title',
    'slug',
    'ulid',
    'summary',
    'verdict',
    'findings',
    'checked',
    'rollback',
    'created_at',
    'updated_at',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: REVIEW_DOC_TYPE },
    issue: nullableString,
    title: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    ulid: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    // The narration contract's three verdict words, so chat, report, and bundle agree.
    verdict: { enum: ['safe-to-merge', 'needs-attention', 'inconclusive'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'description'],
        properties: {
          severity: { enum: ['blocker', 'major', 'minor'] },
          description: { type: 'string', minLength: 1 },
          file: { type: 'string', minLength: 1 },
        },
      },
    },
    checked: { type: 'array', items: { type: 'string', minLength: 1 } },
    rollback: { type: 'string', minLength: 1 },
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiledFeature: ValidateFunction | undefined;
let compiledPlan: ValidateFunction | undefined;
let compiledReview: ValidateFunction | undefined;

/** One human-readable line for a validation error. */
export function formatValidationError(error: { instancePath?: string; message?: string }): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`;
}

function runValidator(validate: ValidateFunction, row: unknown): string[] {
  if (validate(row)) {
    return [];
  }
  const errors = validate.errors as NonNullable<typeof validate.errors>;
  return errors.map(formatValidationError);
}

/** Returns `[]` when `row` is a valid `feature.json` record, else error strings. */
export function validateFeatureRecord(row: unknown): string[] {
  if (!compiledFeature) {
    compiledFeature = ajv.compile(FEATURE_SCHEMA);
  }
  return runValidator(compiledFeature, row);
}

/** Returns `[]` when `row` is a valid `plan.json` record, else error strings. */
export function validatePlanRecord(row: unknown): string[] {
  if (!compiledPlan) {
    compiledPlan = ajv.compile(PLAN_SCHEMA);
  }
  return runValidator(compiledPlan, row);
}

/** Returns `[]` when `row` is a valid `review.json` record, else error strings. */
export function validateReviewRecord(row: unknown): string[] {
  if (!compiledReview) {
    compiledReview = ajv.compile(REVIEW_SCHEMA);
  }
  return runValidator(compiledReview, row);
}
