import { PATHS } from '@/core/constants/paths.js';
import { DESIGN_TOKENS_PLACEHOLDER_NOTE, DesignTokenService } from '@/design-tokens/service.js';
import designTokensSchema from '@/validators/schemas/design-tokens.schema.json';
import { SchemaValidator, type SchemaValidationIssue } from '@/validators/validator.js';

import { readManagedFile, writeManagedFile, type ManagedFile } from './write-pipeline.js';

export class DesignTokensValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'DesignTokensValidationError';
    this.issues = issues;
  }
}

export interface DesignTokensConfig {
  file: ManagedFile;
  tokens: Record<string, unknown> | null;
  placeholder: boolean;
  schema: Record<string, unknown>;
}

export function getDesignTokensConfig(projectRoot: string): DesignTokensConfig {
  const file = readManagedFile(projectRoot, PATHS.DESIGN_TOKENS_FILE);
  let tokens: Record<string, unknown> | null = null;
  if (file.content !== null) {
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        tokens = parsed as Record<string, unknown>;
      }
    } catch {
      tokens = null;
    }
  }
  return {
    file,
    tokens,
    placeholder: tokens?.['$comment'] === DESIGN_TOKENS_PLACEHOLDER_NOTE,
    schema: designTokensSchema as Record<string, unknown>,
  };
}

export interface PutDesignTokensInput {
  content: string;
  baseHash: string | null;
}

export interface PutDesignTokensResult {
  path: string;
  hash: string;
  regenerated: string[];
  regenerationError?: string;
}

export async function putDesignTokens(
  projectRoot: string,
  input: PutDesignTokensInput,
): Promise<PutDesignTokensResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch (err) {
    throw new DesignTokensValidationError('The file is not valid JSON.', [
      {
        path: '/',
        message: err instanceof Error ? err.message : 'JSON parse failed',
      },
    ]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DesignTokensValidationError('The tokens document must be a JSON object.', [
      { path: '/', message: 'Expected an object at the top level.' },
    ]);
  }

  const validation = new SchemaValidator().validate('design-tokens', parsed);
  if (!validation.valid) {
    throw new DesignTokensValidationError(
      'The tokens do not match the design-tokens schema.',
      validation.errors,
    );
  }

  const written = writeManagedFile(projectRoot, {
    relativePath: PATHS.DESIGN_TOKENS_FILE,
    content: input.content,
    baseHash: input.baseHash,
    action: 'dashboard.config.design-tokens.write',
  });

  const regenerated: string[] = [];
  let regenerationError: string | undefined;
  try {
    const service = new DesignTokenService();
    regenerated.push(...(await service.writeDocs(projectRoot)));
    regenerated.push(...(await service.writeThemeExports(projectRoot, null)));
  } catch (err) {
    regenerationError = err instanceof Error ? err.message : String(err);
  }

  const result: PutDesignTokensResult = {
    path: written.path,
    hash: written.hash,
    regenerated,
  };
  if (regenerationError !== undefined) {
    result.regenerationError = regenerationError;
  }
  return result;
}
