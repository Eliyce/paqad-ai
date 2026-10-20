import Ajv, { type ValidateFunction } from 'ajv';

import { ULID_BODY } from '@/core/ids/ulid.js';
import {
  VE_RESULTS,
  VE_SKIP_REASONS,
  VE_SOURCES,
  VE_STEP_STATUSES,
  VISUAL_EVIDENCE_DOC_TYPE,
  VISUAL_EVIDENCE_SCHEMA_VERSION,
} from '@/visual-evidence/types.js';

import { ENVELOPE_HEADER_KEYS } from './envelope.js';
import {
  FEATURE_DOC_SCHEMA_VERSION,
  FEATURE_DOC_TYPE,
  PLAN_DOC_TYPE,
  REVIEW_DOC_TYPE,
} from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

export const ENVELOPE_HEADER_PROPERTIES = {
  schema_version: { type: 'integer', minimum: 1 },
  doc_type: { type: 'string', pattern: '^paqad\\.[a-z0-9-]+$' },
  change: { type: 'string', pattern: `^${ULID_BODY}$` },
  session_id: { type: 'string', minLength: 1 },
  recorded_at: { type: 'string', minLength: 1 },
  content_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
} as const;

export const ENVELOPE_SCHEMA_FRAGMENT = {
  type: 'object',
  required: [...ENVELOPE_HEADER_KEYS],
  properties: ENVELOPE_HEADER_PROPERTIES,
} as const;
function envelopedDocumentSchema(
  docType: string,
  schemaVersion: number,
  required: readonly string[],
  properties: Record<string, unknown>,
) {
  return {
    allOf: [
      ENVELOPE_SCHEMA_FRAGMENT,
      {
        type: 'object',
        additionalProperties: false,
        required: [...required],
        properties: {
          ...ENVELOPE_HEADER_PROPERTIES,
          schema_version: { type: 'integer', const: schemaVersion },
          doc_type: { const: docType },
          ...properties,
        },
      },
    ],
  } as const;
}

function versionedSchema(id: string, legacy: object, current: object) {
  return {
    $id: id,
    if: {
      type: 'object',
      required: ['schema_version'],
      properties: { schema_version: { const: 1 } },
    },
    then: legacy,
    else: current,
  } as const;
}

const lane = { type: ['string', 'null'], enum: ['fast', 'graduated', 'full', null] } as const;

const FEATURE_SCHEMA_V1 = {
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
    status: { enum: ['active', 'paused', 'done', 'spec-only'] },
    spec_id: nullableString,
    session_first_seen: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },
    branch: nullableString,
    base_branch: nullableString,
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

export const FEATURE_SCHEMA = versionedSchema(
  'paqad://schemas/feature.json',
  FEATURE_SCHEMA_V1,
  envelopedDocumentSchema(
    FEATURE_DOC_TYPE,
    FEATURE_DOC_SCHEMA_VERSION,
    [
      ...ENVELOPE_HEADER_KEYS,
      'issue',
      'title',
      'slug',
      'lane',
      'status',
      'spec_id',
      'adapter',
      'branch',
      'base_branch',
      'updated_at',
    ],
    {
      issue: nullableString,
      title: { type: 'string', minLength: 1 },
      slug: { type: 'string', minLength: 1 },
      lane,
      status: { enum: ['active', 'paused', 'done', 'spec-only'] },
      spec_id: nullableString,
      adapter: { type: 'string', minLength: 1 },
      branch: nullableString,
      base_branch: nullableString,
      updated_at: { type: 'string', minLength: 1 },
      kind: { enum: ['fix', 'other'] },
    },
  ),
);

const PLAN_BODY_PROPERTIES = {
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
        classification: {
          enum: ['ac-satisfying', 'necessary-setup', 'scaffolding', 'over-build'],
        },
        files: { type: 'array', items: { type: 'string', minLength: 1 } },
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
  reuse: {
    type: 'object',
    additionalProperties: false,
    required: ['consulted', 'reusing', 'new_constructs'],
    properties: {
      consulted: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'query', 'hits'],
          properties: {
            source: {
              enum: [
                'existing-surface',
                'index-query',
                'reuse-catalog',
                'module-doc',
                'grep',
                'framework-api',
                'framework-docs',
              ],
            },
            query: { type: 'string', minLength: 1 },
            target: { type: 'string', minLength: 1 },
            hits: { type: 'integer', minimum: 0 },
          },
        },
      },
      reusing: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['symbol', 'how'],
          properties: {
            symbol: { type: 'string', minLength: 1 },
            file: { type: 'string', minLength: 1 },
            how: { type: 'string', minLength: 1 },
            package: { type: 'string', minLength: 1 },
            version: { type: 'string', minLength: 1 },
            provenance: { enum: ['asserted', 'unknown-dynamic', 'doc-derived'] },
          },
        },
      },
      new_constructs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'justification'],
          properties: {
            name: { type: 'string', minLength: 1 },
            justification: { type: 'string', minLength: 1 },
            framework_checked: {
              type: 'object',
              additionalProperties: false,
              required: ['package', 'nearest', 'verdict'],
              properties: {
                package: { type: 'string', minLength: 1 },
                nearest: { type: 'string', minLength: 1 },
                verdict: { enum: ['reuse', 'extend', 'insufficient', 'absent'] },
              },
            },
          },
        },
      },
    },
  },
} as const;

const PLAN_SCHEMA_V1 = {
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
    ...PLAN_BODY_PROPERTIES,
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

export const PLAN_SCHEMA = versionedSchema(
  'paqad://schemas/plan.json',
  PLAN_SCHEMA_V1,
  envelopedDocumentSchema(
    PLAN_DOC_TYPE,
    FEATURE_DOC_SCHEMA_VERSION,
    [...ENVELOPE_HEADER_KEYS, 'summary', 'steps', 'modules_touched', 'decisions', 'risks'],
    PLAN_BODY_PROPERTIES,
  ),
);

const REVIEW_BODY_PROPERTIES = {
  summary: { type: 'string', minLength: 1 },
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
        deferred_to: { type: 'string', pattern: `^TD-${ULID_BODY}$` },
      },
    },
  },
  checked: { type: 'array', items: { type: 'string', minLength: 1 } },
  rollback: { type: 'string', minLength: 1 },
} as const;

const REVIEW_SCHEMA_V1 = {
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
    ...REVIEW_BODY_PROPERTIES,
    created_at: { type: 'string', minLength: 1 },
    updated_at: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

export const REVIEW_SCHEMA = versionedSchema(
  'paqad://schemas/review.json',
  REVIEW_SCHEMA_V1,
  envelopedDocumentSchema(
    REVIEW_DOC_TYPE,
    FEATURE_DOC_SCHEMA_VERSION,
    [...ENVELOPE_HEADER_KEYS, 'summary', 'verdict', 'findings', 'checked', 'rollback'],
    REVIEW_BODY_PROPERTIES,
  ),
);

function visualEvidenceStepsSchema(timeKey: 'captured_at' | 'recorded_at') {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['index', 'journey_id', 'journey_step', 'caption', 'dir', timeKey, 'status'],
      properties: {
        index: { type: 'integer', minimum: 1 },
        journey_id: { type: 'string', minLength: 1 },
        journey_step: { type: 'integer', minimum: 1 },
        caption: { type: 'string' },
        dir: { type: 'string', minLength: 1 },
        route: { type: 'string' },
        [timeKey]: { type: 'string', minLength: 1 },
        image_sha256: { type: 'string' },
        image_bytes: { type: 'integer', minimum: 0 },
        status: { enum: [...VE_STEP_STATUSES] },
        failure: { type: 'string' },
        ac: { type: 'string', minLength: 1 },
      },
    },
  } as const;
}

const VISUAL_EVIDENCE_BODY_PROPERTIES = {
  trigger: {
    type: 'object',
    additionalProperties: false,
    required: ['changed_files', 'matched_globs', 'packs'],
    properties: {
      changed_files: { type: 'array', items: { type: 'string' } },
      matched_globs: { type: 'array', items: { type: 'string' } },
      packs: { type: 'array', items: { type: 'string' } },
    },
  },
  plan: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['journey_id', 'capture_script', 'matched_by'],
      properties: {
        journey_id: { type: 'string', minLength: 1 },
        capture_script: { type: 'string', minLength: 1 },
        matched_by: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'surface', 'module'],
            properties: {
              file: { type: 'string' },
              surface: { type: 'string' },
              module: { type: 'string' },
            },
          },
        },
      },
    },
  },
  gif: {
    oneOf: [
      { type: 'null' },
      {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'frames', 'frame_ms', 'sha256', 'bytes'],
        properties: {
          file: { type: 'string', minLength: 1 },
          frames: { type: 'integer', minimum: 0 },
          frame_ms: { type: 'integer', minimum: 1 },
          sha256: { type: 'string', minLength: 1 },
          bytes: { type: 'integer', minimum: 0 },
        },
      },
    ],
  },
  skips: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'detail'],
      properties: {
        reason: { enum: [...VE_SKIP_REASONS] },
        detail: { type: 'string' },
      },
    },
  },
  result: { enum: [...VE_RESULTS] },
  source: { enum: [...VE_SOURCES] },
} as const;

const VISUAL_EVIDENCE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'generated_at',
    'content_hash',
    'trigger',
    'plan',
    'steps',
    'gif',
    'skips',
    'result',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: VISUAL_EVIDENCE_DOC_TYPE },
    generated_at: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
    ...VISUAL_EVIDENCE_BODY_PROPERTIES,
    steps: visualEvidenceStepsSchema('captured_at'),
  },
} as const;

export const VISUAL_EVIDENCE_SCHEMA = versionedSchema(
  'paqad://schemas/visual-evidence.json',
  VISUAL_EVIDENCE_SCHEMA_V1,
  envelopedDocumentSchema(
    VISUAL_EVIDENCE_DOC_TYPE,
    VISUAL_EVIDENCE_SCHEMA_VERSION,
    [...ENVELOPE_HEADER_KEYS, 'trigger', 'plan', 'steps', 'gif', 'skips', 'result'],
    { ...VISUAL_EVIDENCE_BODY_PROPERTIES, steps: visualEvidenceStepsSchema('recorded_at') },
  ),
);

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiledFeature: ValidateFunction | undefined;
let compiledPlan: ValidateFunction | undefined;
let compiledReview: ValidateFunction | undefined;
let compiledVisualEvidence: ValidateFunction | undefined;
let compiledEnvelope: ValidateFunction | undefined;

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

export function validateFeatureRecord(row: unknown): string[] {
  if (!compiledFeature) {
    compiledFeature = ajv.compile(FEATURE_SCHEMA);
  }
  return runValidator(compiledFeature, row);
}

export function validatePlanRecord(row: unknown): string[] {
  if (!compiledPlan) {
    compiledPlan = ajv.compile(PLAN_SCHEMA);
  }
  return runValidator(compiledPlan, row);
}

export function validateReviewRecord(row: unknown): string[] {
  if (!compiledReview) {
    compiledReview = ajv.compile(REVIEW_SCHEMA);
  }
  return runValidator(compiledReview, row);
}

export function validateEnvelopeHeader(value: unknown): string[] {
  if (!compiledEnvelope) {
    compiledEnvelope = ajv.compile(ENVELOPE_SCHEMA_FRAGMENT);
  }
  return runValidator(compiledEnvelope, value);
}

export function validateVisualEvidenceRecord(row: unknown): string[] {
  if (!compiledVisualEvidence) {
    compiledVisualEvidence = ajv.compile(VISUAL_EVIDENCE_SCHEMA);
  }
  return runValidator(compiledVisualEvidence, row);
}
