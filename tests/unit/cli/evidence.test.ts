import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEvidenceCommand } from '@/cli/commands/evidence';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence';
import type { VerificationEvidence } from '@/core/types/verification-evidence';

const EVIDENCE: VerificationEvidence = {
  schema_version: '1.1.0',
  run_id: 'run-1',
  started_at: '2026-06-01T00:00:00.000Z',
  completed_at: '2026-06-01T00:01:00.000Z',
  overall_status: 'pass',
  first_failure_gate: null,
  gates: [
    {
      name: 'code-tests-lint',
      status: 'pass',
      detail: 'Structured test results show 10/10 passing checks',
      remediation: null,
      failures: [],
    },
  ],
};

describe('createEvidenceCommand', () => {
  let root: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let writes: string[];
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-evidence-cli-'));
    writes = [];
    errors = [];
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
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

  function writeEvidence(evidence: VerificationEvidence = EVIDENCE): void {
    const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(evidence), 'utf8');
  }

  it('rejects unknown --format values', async () => {
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--format', 'xml', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/invalid --format/);
  });

  it('exits 4 with guidance when no evidence is present', async () => {
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(4);
    expect(errors.join('')).toMatch(/run verification first/);
  });

  it('emits Markdown by default', async () => {
    writeEvidence();
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--project-root', root], { from: 'user' });
    expect(writes.join('')).toMatch(/## paqad evidence {2}🟢 Safe to merge/);
  });

  it('passes the sha argument into the headline', async () => {
    writeEvidence();
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['abc1234def', '--project-root', root], { from: 'user' });
    expect(writes.join('')).toMatch(/## paqad evidence — abc1234/);
  });

  it('re-emits VerificationEvidence as JSON when --format json', async () => {
    writeEvidence();
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--format', 'json', '--project-root', root], { from: 'user' });
    const parsed = JSON.parse(writes.join('').trim()) as VerificationEvidence;
    expect(parsed.run_id).toBe('run-1');
    expect(parsed.overall_status).toBe('pass');
  });

  it('writes to --output instead of stdout', async () => {
    writeEvidence();
    const out = join(root, 'nested', 'evidence.md');
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--project-root', root, '--output', out], { from: 'user' });
    expect(writes.join('')).toBe('');
    expect(readFileSync(out, 'utf8')).toMatch(/## paqad evidence/);
  });

  it('exits 0 on a passing run even with --fail-on-red', async () => {
    writeEvidence();
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--fail-on-red', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 3 with --fail-on-red when overall status is fail', async () => {
    writeEvidence({ ...EVIDENCE, overall_status: 'fail', first_failure_gate: 'code-tests-lint' });
    const cmd = createEvidenceCommand();
    await cmd.parseAsync(['--fail-on-red', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(3);
    expect(errors.join('')).toMatch(/--fail-on-red tripped/);
  });
});
