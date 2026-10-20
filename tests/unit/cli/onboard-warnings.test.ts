import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RAG_ENGINE_INSTALLING_LINE } from '@/onboarding/rag-onboarding.js';

const { mockOnboardingRun } = vi.hoisted(() => ({
  mockOnboardingRun: vi.fn(),
}));

vi.mock('@/onboarding/orchestrator.js', () => ({
  OnboardingOrchestrator: class {
    run = mockOnboardingRun;
  },
}));

vi.mock('@/cli/ui/banner.js', () => ({
  printBanner: vi.fn(),
  printNextSteps: vi.fn(),
  codexTrustHint: () => null,
}));

import { createOnboardCommand } from '@/cli/commands/onboard.js';

const UNMAPPED_LINE =
  'Commands left unmapped in .paqad/project-profile.yaml (no matching script found): lint, typecheck. Add them there if the project has them.';

let root: string;
let savedIsTTY: boolean | undefined;
let savedChalkLevel: typeof chalk.level;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-onboard-warnings-'));
  savedIsTTY = process.stdout.isTTY;
  savedChalkLevel = chalk.level;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: savedIsTTY, configurable: true });
  chalk.level = savedChalkLevel;
  vi.clearAllMocks();
});

async function onboardPrinting(warnings: string[] | undefined): Promise<string> {
  mockOnboardingRun.mockResolvedValueOnce(
    warnings === undefined ? undefined : { warnings, reverted_framework_values: [] },
  );
  let out = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  try {
    await createOnboardCommand().parseAsync(['--project-root', root, '--rag', 'on'], {
      from: 'user',
    });
  } finally {
    outSpy.mockRestore();
  }
  return out;
}

describe('paqad-ai onboard prints the warnings onboarding returned', () => {
  it('prints the installing line when the search engine is still installing', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const out = await onboardPrinting([RAG_ENGINE_INSTALLING_LINE]);
    expect(out).toContain(`⚠ ${RAG_ENGINE_INSTALLING_LINE}\n`);
  });

  it('prints the turned-off line when the index build failed for another reason', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const out = await onboardPrinting(['RAG was turned off: embedding model download failed']);
    expect(out).toContain('⚠ RAG was turned off: embedding model download failed\n');
  });

  it('prints the unmapped commands line', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const out = await onboardPrinting([UNMAPPED_LINE]);
    expect(out).toContain(`⚠ ${UNMAPPED_LINE}\n`);
  });

  it('prints each warning once, in order, as plain text when stdout is not a terminal', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    chalk.level = 1;
    const out = await onboardPrinting([UNMAPPED_LINE, RAG_ENGINE_INSTALLING_LINE, UNMAPPED_LINE]);
    expect(out.split(UNMAPPED_LINE)).toHaveLength(2);
    expect(out.indexOf(UNMAPPED_LINE)).toBeLessThan(out.indexOf(RAG_ENGINE_INSTALLING_LINE));
    expect(out).not.toContain('\u001b[');
  });

  it('colours each warning yellow on a terminal and keeps the prefix', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    chalk.level = 1;
    const out = await onboardPrinting([RAG_ENGINE_INSTALLING_LINE]);
    expect(out).toContain(chalk.yellow(`⚠ ${RAG_ENGINE_INSTALLING_LINE}`));
  });

  it('prints no warning lines when onboarding returned none', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(await onboardPrinting([])).not.toContain('⚠');
    expect(await onboardPrinting(undefined)).not.toContain('⚠');
  });
});
