// AJV schemas for the per-feature `feature.json` / `plan.json` records (issue
// #339, Phase 1). Framework-owned, in src/ (never under .paqad/), so the LLM can
// never weaken them. `additionalProperties:false` everywhere — an unknown key is
// rejected, which is what makes the stored bytes script-owned rather than a
// hallucination surface. Mirrors `src/stage-evidence/schema.ts`.

import Ajv, { type ValidateFunction } from 'ajv';

import { ULID_BODY } from '@/core/ids/ulid.js';
import {
  VE_RESULTS,
  VE_SKIP_REASONS,
  VE_SOURCES,
  VE_STEP_STATUSES,
  VISUAL_EVIDENCE_DOC_TYPE,
} from '@/visual-evidence/types.js';

import { ENVELOPE_HEADER_KEYS } from './envelope.js';
import { FEATURE_DOC_TYPE, PLAN_DOC_TYPE, REVIEW_DOC_TYPE } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

/**
 * Issue #581 (FR-5) — the six-field envelope header every bundle document and row carries,
 * as one JSON Schema fragment. A file schema composes it through `allOf`, so the header is
 * declared once instead of per file. It sets no `additionalProperties`, which is what lets it
 * compose: a file schema that closes its own shape lists the header keys among its
 * properties (spread {@link ENVELOPE_HEADER_PROPERTIES}). `content_hash` is plain lowercase hex
 * (NFR-2) and `change` is the folder-name ULID (INV-4).
 */
export const ENVELOPE_HEADER_PROPERTIES = {
  schema_version: { type: 'integer', minimum: 1 },
  doc_type: { type: 'string', pattern: '^paqad\\.[a-z0-9-]+$' },
  change: { type: 'string', pattern: `^${ULID_BODY}$` },
  session_id: { type: 'string', minLength: 1 },
  recorded_at: { type: 'string', minLength: 1 },
  content_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
} as const;

// No `$id`: the fragment is embedded inline in many file schemas compiled by one Ajv
// instance, and a repeated `$id` would register the same schema twice.
export const ENVELOPE_SCHEMA_FRAGMENT = {
  type: 'object',
  required: [...ENVELOPE_HEADER_KEYS],
  properties: ENVELOPE_HEADER_PROPERTIES,
} as const;
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
          // Issue #359 — the diff-minimizer verdict for the step. Optional and additive so a
          // plan.json compiled before this change stays valid (INV-3); when present it must
          // be one of the skill's four classifications.
          classification: {
            enum: ['ac-satisfying', 'necessary-setup', 'scaffolding', 'over-build'],
          },
          // Issue #579 — the files the step expects to touch. Optional and additive, so a
          // plan.json compiled before it stays valid.
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
    // Issue #357 — the reuse declaration. OPTIONAL here on purpose: presence is enforced
    // on the compile-INPUT side (`validateReuseSection`), so a `plan.json` written before
    // this change stays valid and readable (AC-6 / INV-3). The nested shape is fully
    // validated, so what IS stored is still script-owned rather than free text.
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

export const VISUAL_EVIDENCE_SCHEMA = {
  $id: 'paqad://schemas/visual-evidence.json',
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
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'index',
          'journey_id',
          'journey_step',
          'caption',
          'dir',
          'captured_at',
          'status',
        ],
        properties: {
          index: { type: 'integer', minimum: 1 },
          journey_id: { type: 'string', minLength: 1 },
          journey_step: { type: 'integer', minimum: 1 },
          caption: { type: 'string' },
          dir: { type: 'string', minLength: 1 },
          route: { type: 'string' },
          captured_at: { type: 'string', minLength: 1 },
          image_sha256: { type: 'string' },
          image_bytes: { type: 'integer', minimum: 0 },
          status: { enum: [...VE_STEP_STATUSES] },
          failure: { type: 'string' },
          // Issue #579 — the criterion an agent-attached screenshot proves. Optional, additive.
          ac: { type: 'string', minLength: 1 },
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
    // Issue #579 — present only when agent-attached steps are in the manifest.
    source: { enum: [...VE_SOURCES] },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiledFeature: ValidateFunction | undefined;
let compiledPlan: ValidateFunction | undefined;
let compiledReview: ValidateFunction | undefined;
let compiledVisualEvidence: ValidateFunction | undefined;
let compiledEnvelope: ValidateFunction | undefined;

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

/**
 * Issue #581 — returns `[]` when `value` carries a valid six-field envelope header, else error
 * strings. Checks only the header, so any bundle document or row can be run through it.
 */
export function validateEnvelopeHeader(value: unknown): string[] {
  if (!compiledEnvelope) {
    compiledEnvelope = ajv.compile(ENVELOPE_SCHEMA_FRAGMENT);
  }
  return runValidator(compiledEnvelope, value);
}

/** Returns `[]` when `row` is a valid `visual-evidence.json` manifest, else error strings. */
export function validateVisualEvidenceRecord(row: unknown): string[] {
  if (!compiledVisualEvidence) {
    compiledVisualEvidence = ajv.compile(VISUAL_EVIDENCE_SCHEMA);
  }
  return runValidator(compiledVisualEvidence, row);
}
