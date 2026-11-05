import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

vi.mock('@/stage-isolation/recipes.js', async (original) => ({
  ...(await original<typeof import('@/stage-isolation/recipes.js')>()),
  resolveRecipe: () => {
    throw new Error('the review-recipe recipe is missing; run the named repair');
  },
}));

describe('stage brief with a missing recipe', () => {
  const SES = 'ses_missing_recipe';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-missing-recipe-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('FR-89: still prints the brief and names the repair, with no recipe heading', async () => {
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Missing recipe',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    await createStageCommand().parseAsync(
      ['brief', 'review', '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    const printed = lines.join('\n');
    expect(printed).toContain('the review-recipe recipe is missing; run the named repair');
    expect(printed).not.toContain('## Your recipe');
    expect(process.exitCode).toBeUndefined();
  });
});
