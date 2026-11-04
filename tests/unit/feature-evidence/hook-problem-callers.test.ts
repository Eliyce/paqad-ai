import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeliveryLinkCommand } from '@/cli/commands/delivery-link.js';
import * as gitHooks from '@/feature-evidence/git-hooks.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';

const PROBLEM =
  "Couldn't make .git/hooks/commit-msg executable: denied. Run chmod +x .git/hooks/commit-msg, or git won't run it.";

describe('a hook that cannot be made executable, through its other callers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-hook-problem-'));
    vi.spyOn(gitHooks, 'installGitHooks').mockReturnValue({
      installed: [],
      skipped: [],
      notAGitRepo: false,
      problems: [PROBLEM],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('onboarding lists it among its warnings', async () => {
    const result = await new OnboardingOrchestrator().run({
      projectRoot: root,
      interactive: false,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    expect(result.warnings).toContain(PROBLEM);
  });

  it('delivery-link install writes it to stderr and keeps its output', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await createDeliveryLinkCommand().parseAsync(['install', '--project-root', root], {
      from: 'user',
    });
    expect(stderr).toEqual([`${PROBLEM}\n`]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
