import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getProjectSecret,
  getSecretPermissionWarning,
  readProjectSecrets,
  redactSecrets,
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
    delete process.env.VOYAGE_API_KEY;
    rmSync(projectRoot, { recursive: true, force: true });
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
    process.env.VOYAGE_API_KEY = 'voyage-env';

    appendRagAudit(projectRoot, 'WARN', 'rag-build-failed', {
      reason: 'provider rejected sk-local and voyage-env',
    });

    const audit = readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8');
    expect(audit).toContain('[REDACTED]');
    expect(audit).not.toContain('sk-local');
    expect(audit).not.toContain('voyage-env');
  });
});
