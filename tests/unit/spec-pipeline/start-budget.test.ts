import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { labelPrompt } from '@/spec-pipeline/labeling.js';
import type { GroundingArtifact } from '@/spec-pipeline/types.js';

import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

const BUDGET_FALLBACK: GroundingArtifact = {
  references: [{ kind: 'doc', ref: 'docs/modules/export/business.md' }],
  terms: ['Report export'],
  sparse: false,
  path: 'docs-fallback',
  mode: 'lexical-fallback',
  fallback_reason: 'budget-exceeded',
};

vi.mock('@/spec-pipeline/grounding.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/spec-pipeline/grounding.js')>();
  return { ...actual, groundAreaAsync: vi.fn(async () => BUDGET_FALLBACK) };
});

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('spec pipeline start after the grounding budget runs out', () => {
  it('writes grounding.json and the label, prints the fallback, then exits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-sp-budget-'));
    roots.push(root);
    pinSpecPipelineOff(root);
    openFeatureChange(root, 'ses_budget', {
      adapter: 'claude-code',
      title: 'budget',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
    });
    const request = join(root, 'request.md');
    writeFileSync(request, 'Let customers download their invoices as CSV.', 'utf8');
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((
      _chunk: unknown,
      done?: () => void,
    ) => {
      done?.();
      return true;
    }) as never);

    await createSpecPipelineCommand().parseAsync(
      ['start', '--request-file', request, '--project-root', root, '--session', 'ses_budget'],
      { from: 'user' },
    );
    write.mockRestore();

    expect(JSON.parse(out.at(-1)!)).toMatchObject({
      grounding: 'lexical-fallback',
      grounding_reason: 'budget-exceeded',
    });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('AC-44: labels a long request in well under the five seconds the budget leaves', () => {
    const request = 'Let customers download their invoices as CSV, filtered by month. '.repeat(400);
    const grounding: GroundingArtifact = {
      ...BUDGET_FALLBACK,
      terms: Array.from({ length: 2000 }, (_, i) => `term ${i}`),
    };
    const started = performance.now();
    labelPrompt(request, grounding);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
