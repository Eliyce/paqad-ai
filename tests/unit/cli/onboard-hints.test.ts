import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOnboardingRun } = vi.hoisted(() => ({ mockOnboardingRun: vi.fn() }));

vi.mock('@/onboarding/orchestrator.js', () => ({
  OnboardingOrchestrator: class {
    run = mockOnboardingRun;
  },
}));

import { createOnboardCommand } from '@/cli/commands/onboard.js';
import { OPEN_JOURNEY_LINE, journeyPointer } from '@/cli/ui/journey-pointer.js';
import { journeyHosts } from '@/onboarding/journey/setup.js';

import { seedRun, tempRoot, writeFile } from '../onboarding/journey/fixtures/journey.js';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('the plain terminal onboard', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-onboard-hints-');
    mockOnboardingRun.mockResolvedValue({
      decision_pause_supported_adapters: ['claude-code', 'codex-cli', 'aider'],
      reverted_framework_values: [],
      warnings: [],
      kept_files: [],
      drift_review_targets: [],
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    mockOnboardingRun.mockReset();
  });

  async function onboard(): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(
      (line?: unknown) => void lines.push(String(line ?? '')),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await createOnboardCommand().parseAsync(
      ['--project-root', root, '--rag', 'off', '--stack', 'react'],
      {
        from: 'user',
      },
    );
    vi.restoreAllMocks();
    return lines.join('\n');
  }

  it('AC-17 INV-21: prints one pointer after a first onboarding, naming only hosts with skills', async () => {
    const out = await onboard();
    expect(out).toContain('Next: say "onboard paqad" in Claude Code or Codex');
    expect(out).not.toContain('Aider');
    expect(out.match(/onboard paqad/gu)).toHaveLength(1);
  });

  it('INV-20 INV-21: an already-onboarded repo gets no pointer', async () => {
    writeFile(root, '.paqad/onboarding-manifest.json', '{"providers":["claude-code"]}');
    expect(await onboard()).not.toContain('onboard paqad');
  });

  it('NFR-10: an unfinished journey points to Resume instead of refreshing', async () => {
    seedRun(root, { status: 'paused' });
    expect(await onboard()).toContain(OPEN_JOURNEY_LINE);
    expect(mockOnboardingRun).not.toHaveBeenCalled();
  });

  it('AC-17: the pointer names no host when none can run the journey', () => {
    expect(journeyPointer(journeyHosts(['aider', 'junie']))).toBeNull();
    expect(journeyPointer(['cursor'])).toBe(
      'Next: say "onboard paqad" in Cursor to write your docs and rules as a guided journey.',
    );
  });

  it('keeps every "Re-run paqad-ai onboard" hint pointing at a command that exists', () => {
    const hints = sourceFiles(join(process.cwd(), 'src')).flatMap((file) =>
      (readFileSync(file, 'utf8').match(/Re-run paqad-ai onboard[^`'"\n]*/gu) ?? []).map(
        (hint) => ({ file, hint }),
      ),
    );
    const flags = createOnboardCommand().options.map((option) => option.long);
    for (const { file, hint } of hints) {
      for (const flag of hint.match(/--[a-z-]+/gu) ?? [])
        expect(flags, `${file}: ${hint}`).toContain(flag);
    }
  });
});
