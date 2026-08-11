// AJV validation for the site-map artifacts (app-map.yaml + per-journey YAML). Framework-
// owned: the committed JSON schemas live in src/validators/schemas/ so they are packaged
// into dist and can never be weakened from a project. A run validates every artifact it
// writes before persisting, so a malformed map fails loudly rather than shipping a shape a
// consumer would mis-read. See docs/specs/site-map-capability.plan.md §II.3 (assembly).

import Ajv, { type ValidateFunction } from 'ajv';

import appMapSchema from '../validators/schemas/app-map.schema.json';
import journeySchema from '../validators/schemas/journey.schema.json';
import siteMapAnswersSchema from '../validators/schemas/site-map-answers.schema.json';
import type { AppMap, Journey } from '@/core/types/site-map.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiledAppMap: ValidateFunction | undefined;
let compiledJourney: ValidateFunction | undefined;
let compiledAnswers: ValidateFunction | undefined;

function appMapValidator(): ValidateFunction {
  if (!compiledAppMap) {
    compiledAppMap = ajv.compile(appMapSchema);
  }
  return compiledAppMap;
}

function journeyValidator(): ValidateFunction {
  if (!compiledJourney) {
    compiledJourney = ajv.compile(journeySchema);
  }
  return compiledJourney;
}

function answersValidator(): ValidateFunction {
  if (!compiledAnswers) {
    compiledAnswers = ajv.compile(siteMapAnswersSchema);
  }
  return compiledAnswers;
}

export interface SiteMapValidation {
  valid: boolean;
  /** Human-readable `<path> <message>` lines; empty when valid. */
  errors: string[];
}

function toValidation(validate: ValidateFunction, data: unknown): SiteMapValidation {
  if (validate(data)) {
    return { valid: true, errors: [] };
  }
  /* v8 ignore next -- ajv always populates errors[] after a failed validate */
  const rawErrors = validate.errors ?? [];
  const errors = rawErrors.map((error) => {
    const path = error.instancePath.length > 0 ? error.instancePath : '/';
    /* v8 ignore next -- ajv always sets a message under the default options */
    const message = error.message ?? 'invalid';
    return `${path} ${message}`.trim();
  });
  return { valid: false, errors };
}

/** Validate a value against the committed app-map schema. */
export function validateAppMap(data: unknown): SiteMapValidation {
  return toValidation(appMapValidator(), data);
}

/** Validate a value against the committed journey schema. */
export function validateJourney(data: unknown): SiteMapValidation {
  return toValidation(journeyValidator(), data);
}

/** Narrowing helper: a schema-valid value is an {@link AppMap}. */
export function isAppMap(data: unknown): data is AppMap {
  return validateAppMap(data).valid;
}

/** Narrowing helper: a schema-valid value is a {@link Journey}. */
export function isJourney(data: unknown): data is Journey {
  return validateJourney(data).valid;
}

/** Validate a value against the committed site-map creation-answers schema (issue #466). */
export function validateSiteMapAnswers(data: unknown): SiteMapValidation {
  return toValidation(answersValidator(), data);
}
