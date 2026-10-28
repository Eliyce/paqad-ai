import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { labelPrompt } from '@/spec-pipeline/labeling.js';
import { stagedFilePath } from '@/spec-pipeline/run-store.js';
import type { GroundingArtifact } from '@/spec-pipeline/types.js';

import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('spec pipeline start on this repo', () => {
  it('AC-44: returns in under 20 seconds, and labelling fits in the time the budget leaves', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-sp-timing-'));
    roots.push(root);
    pinSpecPipelineOff(root);
    cpSync(join(process.cwd(), 'docs/modules'), join(root, 'docs/modules'), { recursive: true });
    const dir = openFeatureChange(root, 'ses_timing', {
      adapter: 'claude-code',
      title: 'timing',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ3',
    });
    const request = join(root, 'request.md');
    writeFileSync(
      request,
      readFileSync(join(process.cwd(), 'docs/modules/claude-plugin/index/summary.md'), 'utf8'),
      'utf8',
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const started = performance.now();
    await createSpecPipelineCommand().parseAsync(
      ['start', '--request-file', request, '--project-root', root, '--session', 'ses_timing'],
      { from: 'user' },
    );
    const startMs = performance.now() - started;

    const grounding = JSON.parse(
      readFileSync(join(root, stagedFilePath(dir, 'grounding')), 'utf8'),
    ) as GroundingArtifact;
    const labelStarted = performance.now();
    labelPrompt(readFileSync(request, 'utf8'), grounding);
    const labelMs = performance.now() - labelStarted;

    expect(process.exitCode ?? 0).toBe(0);
    expect(grounding.terms.length).toBeGreaterThan(0);
    expect(startMs).toBeLessThan(20_000);
    expect(labelMs).toBeLessThan(20_000 - 15_000);
  }, 30_000);
});
