import Ajv, { type ErrorObject } from 'ajv';

import adversarialReviewReportSchema from './schemas/adversarial-review-report.schema.json';
import apiEndpointDocSchema from './schemas/api-endpoint-doc.schema.json';
import contextHitLogSchema from './schemas/context-hit-log.schema.json';
import detectionReportSchema from './schemas/detection-report.schema.json';
import designTokensSchema from './schemas/design-tokens.schema.json';
import docProgressSchema from './schemas/doc-progress.schema.json';
import errorCatalogSchema from './schemas/error-catalog.schema.json';
import featureDevelopmentPolicySchema from './schemas/feature-development-policy.schema.json';
import gateResultSchema from './schemas/gate-result.schema.json';
import handoffArtifactSchema from './schemas/handoff-artifact.schema.json';
import integrationDocSchema from './schemas/integration-doc.schema.json';
import onboardingManifestSchema from './schemas/onboarding-manifest.schema.json';
import pentestProgressSchema from './schemas/pentest-progress.schema.json';
import pentestReportSchema from './schemas/pentest-report.schema.json';
import projectProfileSchema from './schemas/project-profile.schema.json';
import skillFrontmatterSchema from './schemas/skill-frontmatter.schema.json';
import stackPackSchema from './schemas/stack-pack.schema.json';
import testOutputResultSchema from './schemas/test-output-result.schema.json';

export interface SchemaValidationIssue {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: SchemaValidationIssue[];
}

const SCHEMAS = [
  projectProfileSchema,
  detectionReportSchema,
  designTokensSchema,
  docProgressSchema,
  onboardingManifestSchema,
  pentestProgressSchema,
  pentestReportSchema,
  handoffArtifactSchema,
  adversarialReviewReportSchema,
  contextHitLogSchema,
  apiEndpointDocSchema,
  integrationDocSchema,
  errorCatalogSchema,
  featureDevelopmentPolicySchema,
  skillFrontmatterSchema,
  gateResultSchema,
  stackPackSchema,
  testOutputResultSchema,
];

export class SchemaValidator {
  private readonly ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, verbose: true });
    this.ajv.addFormat(
      'date-time',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    );
    this.registerSchemas();
  }

  validate(schemaId: string, data: unknown): ValidationResult {
    const valid = this.ajv.validate(schemaId, data);

    return {
      valid: valid as boolean,
      errors: valid ? [] : this.formatErrors(this.ajv.errors),
    };
  }

  private registerSchemas(): void {
    for (const schema of SCHEMAS) {
      this.ajv.addSchema(schema);
    }
  }

  private formatErrors(errors: ErrorObject[] | null | undefined): SchemaValidationIssue[] {
    if (errors === null || errors === undefined) {
      return [];
    }

    return errors.map((error) => ({
      path: error.instancePath || '/',
      message: error.message ?? 'Validation failed',
      expected: error.schemaPath,
      actual: error.data === undefined ? undefined : JSON.stringify(error.data),
    }));
  }
}
