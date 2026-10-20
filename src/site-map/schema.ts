import Ajv, { type ValidateFunction } from 'ajv';

import appMapSchema from '../validators/schemas/app-map.schema.json';
import journeySchema from '../validators/schemas/journey.schema.json';
import journeyCaptureSchema from '../validators/schemas/journey-capture.schema.json';
import siteMapAnswersSchema from '../validators/schemas/site-map-answers.schema.json';
import type { AppMap, Journey } from '@/core/types/site-map.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiledAppMap: ValidateFunction | undefined;
let compiledJourney: ValidateFunction | undefined;
let compiledJourneyCapture: ValidateFunction | undefined;
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

function journeyCaptureValidator(): ValidateFunction {
  if (!compiledJourneyCapture) {
    compiledJourneyCapture = ajv.compile(journeyCaptureSchema);
  }
  return compiledJourneyCapture;
}

function answersValidator(): ValidateFunction {
  if (!compiledAnswers) {
    compiledAnswers = ajv.compile(siteMapAnswersSchema);
  }
  return compiledAnswers;
}

export interface SiteMapValidation {
  valid: boolean;
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

export function validateAppMap(data: unknown): SiteMapValidation {
  return toValidation(appMapValidator(), data);
}

export function validateJourney(data: unknown): SiteMapValidation {
  return toValidation(journeyValidator(), data);
}

export function validateJourneyCapture(data: unknown): SiteMapValidation {
  return toValidation(journeyCaptureValidator(), data);
}

export function isAppMap(data: unknown): data is AppMap {
  return validateAppMap(data).valid;
}

export function isJourney(data: unknown): data is Journey {
  return validateJourney(data).valid;
}

export function validateSiteMapAnswers(data: unknown): SiteMapValidation {
  return toValidation(answersValidator(), data);
}
