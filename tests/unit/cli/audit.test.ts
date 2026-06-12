import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditCommand } from '@/cli/commands/audit';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger';

function seed(root: string) {
  appendEvidenceRows(root, [
    buildEvidenceRow({
      ts: '2026-06-10T00:00:00.000Z',
      engine: 'verification-gate',
      code: 'mutation-testing',
      subject_digest: 'subj',
      verdict: 'pass',
      strength_class: 'deterministic',
    }),
  ]);
}

describe('createAuditCommand', () => {
  let root: string;
  let writes: string[];
  let errors: string[];
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-cli-'));
    writes = [];
    errors = [];
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  async function run(args: string[]) {
    await createAuditCommand().parseAsync(['export', ...args, '--project-root', root], {
      from: 'user',
    });
  }

  it('rejects an unknown --format', async () => {
    await run(['--format', 'xml']);
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/invalid --format/);
  });

  it('rejects an unparseable --since', async () => {
    await run(['--since', 'yesterday']);
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/invalid --since/);
  });

  it('writes OCSF to stdout by default', async () => {
    seed(root);
    await run([]);
    const parsed = JSON.parse(writes.join('').trim()) as Record<string, unknown>;
    expect(parsed.class_uid).toBe(6003);
    expect(process.exitCode).toBe(0);
  });

  it('emits an empty payload when there is nothing to export', async () => {
    await run(['--format', 'jsonl']);
    expect(writes.join('')).toBe('');
    expect(process.exitCode).toBe(0);
  });

  it('writes to --out and reports the count on stderr', async () => {
    seed(root);
    const out = join(root, 'nested', 'audit.ndjson');
    await run(['--format', 'ecs', '--out', out]);
    expect(writes.join('')).toBe('');
    expect(errors.join('')).toMatch(/wrote 1 ecs event/);
    const written = readFileSync(out, 'utf8');
    expect(JSON.parse(written.trim())['@timestamp']).toBe('2026-06-10T00:00:00.000Z');
    expect(written.endsWith('\n')).toBe(true);
  });

  it('honours --format jsonl and --redact together', async () => {
    appendEvidenceRows(root, [
      buildEvidenceRow({
        ts: '2026-06-10T00:00:00.000Z',
        engine: 'verification-gate',
        code: 'mutation-testing',
        subject_digest: 'subj',
        verdict: 'pass',
        strength_class: 'deterministic',
        detail: 'token=secret',
      }),
    ]);
    await run(['--format', 'jsonl', '--redact']);
    expect(writes.join('')).not.toContain('secret');
    expect(writes.join('')).toContain('[REDACTED]');
  });
});
