import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { SchemaValidator, type SchemaValidationIssue } from '@/validators/validator.js';

import { appendDashboardAudit } from './approvals.js';
import { fileMtime } from './collectors/fs-helpers.js';
import { ageInDays } from './scoring/index.js';

export class RagValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'RagValidationError';
    this.issues = issues;
  }
}

export interface RagStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  indexPresent: boolean;
  indexAgeDays: number | null;
}

export interface RagConfig {
  intelligence: IntelligenceConfig | null;
  status: RagStatus;
}

export function getRagConfig(projectRoot: string): RagConfig {
  const profile = readProjectProfile(projectRoot);
  const intelligence = profile?.intelligence ?? null;

  const vectorMeta = join(projectRoot, PATHS.VECTOR_META);
  const vectorIndex = join(projectRoot, PATHS.VECTOR_INDEX);
  const indexPresent = existsSync(vectorMeta) || existsSync(vectorIndex);
  const indexMtime = fileMtime(vectorMeta) ?? fileMtime(vectorIndex);

  return {
    intelligence,
    status: {
      enabled: intelligence?.rag_enabled === true,
      provider: intelligence?.embedding_provider ?? null,
      model: intelligence?.embedding_model ?? null,
      indexPresent,
      indexAgeDays: ageInDays(indexMtime),
    },
  };
}

export interface PutRagConfigResult {
  path: string;
  intelligence: IntelligenceConfig;
}

const FIELD_CHECKS: Record<string, (value: unknown) => string | null> = {
  rag_enabled: (value) => (typeof value === 'boolean' ? null : 'Expected a boolean.'),
  embedding_provider: (value) => (typeof value === 'string' ? null : 'Expected a string.'),
  embedding_model: (value) => (typeof value === 'string' ? null : 'Expected a string.'),
  rag_similarity_threshold: (value) =>
    typeof value === 'number' && value >= 0 && value <= 1
      ? null
      : 'Expected a number between 0 and 1.',
  rag_top_n: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? null
      : 'Expected a positive integer.',
  rag_max_file_size: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? null
      : 'Expected a positive integer.',
  rag_base_branch: (value) => (typeof value === 'string' ? null : 'Expected a string.'),
  existing_surface_tokens: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? null
      : 'Expected a positive integer.',
};

export function putRagConfig(projectRoot: string, candidate: unknown): PutRagConfigResult {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new RagValidationError('The RAG settings must be an object.', [
      { path: '/', message: 'Expected the partial intelligence object.' },
    ]);
  }

  const issues: SchemaValidationIssue[] = [];
  const patch: Record<string, unknown> = {};
  const candidateRecord = candidate as Record<string, unknown>;
  const allowedKeys = Object.keys(FIELD_CHECKS);
  for (const key of Object.keys(candidateRecord)) {
    if (candidateRecord[key] !== undefined && !allowedKeys.includes(key)) {
      issues.push({
        path: `/${key}`,
        message: `Unknown setting. Allowed: ${allowedKeys.join(', ')}.`,
      });
    }
  }
  for (const key of allowedKeys) {
    const value = candidateRecord[key];
    if (value === undefined) {
      continue;
    }
    const problem = FIELD_CHECKS[key]!(value);
    if (problem !== null) {
      issues.push({ path: `/${key}`, message: problem });
      continue;
    }
    patch[key] = value;
  }
  if (issues.length > 0) {
    throw new RagValidationError('The RAG settings are invalid.', issues);
  }

  const profile = readProjectProfile(projectRoot);
  if (profile === null) {
    throw new RagValidationError('No project profile found. Run `paqad-ai onboard` first.', [
      { path: '/', message: 'project-profile.yaml is missing.' },
    ]);
  }

  const intelligence = normalizeIntelligenceConfig({
    ...profile.intelligence,
    ...(patch as Partial<IntelligenceConfig>),
  });
  const updated = { ...profile, intelligence };

  const validation = new SchemaValidator().validate('project-profile', updated);
  if (!validation.valid) {
    throw new RagValidationError(
      'The resulting profile does not match the project-profile schema.',
      validation.errors,
    );
  }

  const path = writeProjectProfile(projectRoot, updated);
  syncFrameworkConfig(projectRoot, { intelligence });
  appendDashboardAudit(projectRoot, 'dashboard.config.rag.write', {
    path: PATHS.PROJECT_CONFIG,
  });
  return { path, intelligence };
}
