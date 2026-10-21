import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getProjectSecret,
  getSecretPermissionWarning,
  readProjectSecrets,
  redactSecrets,
  removeProjectSecrets,
  writeProjectSecret,
} from '@/rag/secrets.js';
import { appendRagAudit } from '@/rag/audit.js';

describe('RAG secrets helpers', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-secrets-'));
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('clears an existing secrets file in place and never creates a missing one', () => {
    const path = writeProjectSecret(projectRoot, 'OPENAI_API_KEY', 'sk-a-much-longer-local-secret');
    removeProjectSecrets(projectRoot);
    expect(readFileSync(path, 'utf8')).toBe('# Local project secrets for paqad-ai RAG\n');
    expect(readProjectSecrets(projectRoot)).toEqual({});

    rmSync(path);
    removeProjectSecrets(projectRoot);
    expect(existsSync(path)).toBe(false);
  });

  it('surfaces errors other than a missing secrets file', () => {
    const path = writeProjectSecret(projectRoot, 'OPENAI_API_KEY', 'sk-local');
    rmSync(path);
    mkdirSync(path);
    expect(() => removeProjectSecrets(projectRoot)).toThrow();
  });

  it('writes and reads project-local secrets', () => {
    const path = writeProjectSecret(projectRoot, 'OPENAI_API_KEY', 'sk-local');
    expect(readFileSync(path, 'utf8')).toContain('OPENAI_API_KEY=sk-local');
    expect(readProjectSecrets(projectRoot)).toEqual({ OPENAI_API_KEY: 'sk-local' });
  });

  it('prefers process env over the local secrets file', () => {
    writeProjectSecret(projectRoot, 'OPENAI_API_KEY', 'sk-local');
    process.env.OPENAI_API_KEY = 'sk-env';

    expect(getProjectSecret(projectRoot, 'OPENAI_API_KEY')).toBe('sk-env');
  });

  it('redacts known secrets from output and warns on permissive files', () => {
    const secretsPath = writeProjectSecret(projectRoot, 'VOYAGE_API_KEY', 'voyage-secret');
    chmodSync(secretsPath, 0o644);

    expect(redactSecrets('token=voyage-secret', projectRoot)).toBe('token=[REDACTED]');
    expect(getSecretPermissionWarning(projectRoot)).toContain('too permissive');
  });

  it('redacts secret values from rag audit entries', () => {
    writeProjectSecret(projectRoot, 'OPENAI_API_KEY', 'sk-local');
    process.env.OPENAI_API_KEY = 'sk-env';

    appendRagAudit(projectRoot, 'WARN', 'rag-build-failed', {
      reason: 'provider rejected sk-local and sk-env',
    });

    const audit = readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8');
    expect(audit).toContain('[REDACTED]');
    expect(audit).not.toContain('sk-local');
    expect(audit).not.toContain('sk-env');
  });

  it('still redacts a leftover VOYAGE_API_KEY stored in the secrets file', () => {
    writeProjectSecret(projectRoot, 'VOYAGE_API_KEY', 'pa-leftover-voyage-key');

    expect(redactSecrets('Bearer pa-leftover-voyage-key', projectRoot)).toBe('Bearer [REDACTED]');
    appendRagAudit(projectRoot, 'WARN', 'rag-provider-removed', {
      reason: 'old key pa-leftover-voyage-key',
    });

    const audit = readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8');
    expect(audit).toContain('[REDACTED]');
    expect(audit).not.toContain('pa-leftover-voyage-key');
  });
});
