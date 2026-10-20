import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import {
  DELIVERY_POLICY_FILE,
  loadDeliveryPolicy,
  renderDefaultDeliveryPolicyYaml,
} from '@/pipeline/delivery-policy.js';
import deliveryPolicySchema from '@/validators/schemas/delivery-policy.schema.json';
import { SchemaValidator, type SchemaValidationIssue } from '@/validators/validator.js';

import { readManagedFile, writeManagedFile, type ManagedFile } from './write-pipeline.js';

const RELATIVE_PATH = `${PATHS.WORKFLOWS_DIR}/${DELIVERY_POLICY_FILE}`;

export class DeliveryPolicyValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'DeliveryPolicyValidationError';
    this.issues = issues;
  }
}

export interface DeliveryPolicyConfig {
  resolved: ResolvedDeliveryPolicy;
  warnings: string[];
  file: ManagedFile;
  defaultsYaml: string;
  schema: Record<string, unknown>;
}

export function getDeliveryPolicyConfig(projectRoot: string): DeliveryPolicyConfig {
  const { policy, warnings } = loadDeliveryPolicy(projectRoot);
  return {
    resolved: policy,
    warnings,
    file: readManagedFile(projectRoot, RELATIVE_PATH),
    defaultsYaml: renderDefaultDeliveryPolicyYaml(),
    schema: deliveryPolicySchema as Record<string, unknown>,
  };
}

export interface PutDeliveryPolicyInput {
  content: string;
  baseHash: string | null;
}

export interface PutDeliveryPolicyResult {
  path: string;
  hash: string;
  resolved: ResolvedDeliveryPolicy;
}

export function putDeliveryPolicy(
  projectRoot: string,
  input: PutDeliveryPolicyInput,
): PutDeliveryPolicyResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(input.content);
  } catch (err) {
    throw new DeliveryPolicyValidationError('The file is not valid YAML.', [
      {
        path: '/',
        message: err instanceof Error ? err.message : 'YAML parse failed',
      },
    ]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DeliveryPolicyValidationError('The policy must be a YAML mapping.', [
      { path: '/', message: 'Expected a mapping at the top level.' },
    ]);
  }

  const validation = new SchemaValidator().validate('delivery-policy', parsed);
  if (!validation.valid) {
    throw new DeliveryPolicyValidationError(
      'The policy does not match the delivery-policy schema.',
      validation.errors,
    );
  }

  const written = writeManagedFile(projectRoot, {
    relativePath: RELATIVE_PATH,
    content: input.content,
    baseHash: input.baseHash,
    action: 'dashboard.config.delivery-policy.write',
  });

  return {
    path: written.path,
    hash: written.hash,
    resolved: loadDeliveryPolicy(projectRoot).policy,
  };
}
