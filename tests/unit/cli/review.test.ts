import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReviewCommand } from '@/cli/commands/review.js';
import { createProgram } from '@/cli/program.js';
import { readFeatureReview } from '@/feature-evidence/artifacts.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

// Issue #402 — the review stage's counterpart to `plan compile`. Before it, review owned
// no rigid bundle file, so its evidence was a free-written .md with no defined home.
describe('paqad-ai review record', () => {
  let root: string;
  const SES = 'ses_cli_review';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-review-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
    await createReviewCommand().parseAsync(
      ['record', ...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    return lines;
  }

  function writeTemplate(body: unknown): string {
    const path = join(root, 'review-input.json');
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  const valid = {
    summary: 'Checked correctness, regressions and rollback risk.',
    verdict: 'safe-to-merge',
    findings: [{ severity: 'minor', description: 'naming nit', file: 'src/a.ts' }],
    checked: ['correctness', 'regressions'],
    rollback: 'Revert the commit; nothing migrated.',
  };

  function activeFeature(): void {
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Rigid bundle only',
      issue: '402',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('review');
  });

  it('records review.json into the active feature and deletes the transient input', async () => {
    activeFeature();
    const input = writeTemplate(valid);
    const lines = await run(input);
    expect(lines.some((l) => l.includes('"recorded":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    const record = readFeatureReview(root, dir);
    expect(record?.verdict).toBe('safe-to-merge');
    expect(record?.findings).toHaveLength(1);
    // Transient scratch: the input file is gone.
    expect(existsSync(input)).toBe(false);
  });

  it('keeps the input with --keep-input', async () => {
    activeFeature();
    const input = writeTemplate(valid);
    await run(input, '--keep-input');
    expect(existsSync(input)).toBe(true);
  });

  it('exits non-zero when no feature is active', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run(writeTemplate(valid));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('No active feature');
  });

  it('exits non-zero on a malformed template', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    const path = join(root, 'bad.json');
    writeFileSync(path, '{ not json');
    await run(path);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not read/parse');
  });

  it('exits non-zero when summary is missing', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run(writeTemplate({ ...valid, summary: '' }));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('non-empty "summary"');
  });

  it('names the allowed verdict words rather than surfacing a raw schema error', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run(writeTemplate({ ...valid, verdict: 'looks-fine' }));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('safe-to-merge, needs-attention, inconclusive');
  });

  it('exits non-zero when rollback is missing', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run(writeTemplate({ ...valid, rollback: '' }));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('non-empty "rollback"');
  });

  it('exits non-zero when the record fails schema validation', async () => {
    activeFeature();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    // An empty finding description is rejected by REVIEW_SCHEMA (minLength 1).
    await run(writeTemplate({ ...valid, findings: [{ severity: 'minor', description: '' }] }));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not record review');
  });
});
