import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import type { CommandStep } from '@/checks/command-chain.js';
import type { DeliveryShell } from '@/delivery/runner.js';

// The && chain runner (issue #554, Part A): a mapped command is an ordered chain of argv steps,
// split on the standalone `&&` token, with a quote-aware tokenizer and no shell interpretation.
describe('parseCommandChain', () => {
  it('splits the onboarding mkdir-&&-pest command into two argv steps (AC-1)', () => {
    const parsed = parseCommandChain(
      'mkdir -p .paqad/test-results && ./vendor/bin/pest --log-junit .paqad/test-results/pest.xml',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.steps).toEqual<CommandStep[]>([
      { bin: 'mkdir', args: ['-p', '.paqad/test-results'] },
      { bin: './vendor/bin/pest', args: ['--log-junit', '.paqad/test-results/pest.xml'] },
    ]);
  });

  it('is quote-aware: a quoted value becomes one argv element with the quotes removed', () => {
    const parsed = parseCommandChain('php artisan test --filter="Foo Bar"');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.steps).toEqual<CommandStep[]>([
      { bin: 'php', args: ['artisan', 'test', '--filter=Foo Bar'] },
    ]);
  });

  it('accepts single quotes too', () => {
    const parsed = parseCommandChain("go test ./... -run 'Foo Bar'");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.steps[0]).toEqual({ bin: 'go', args: ['test', './...', '-run', 'Foo Bar'] });
  });

  it('rejects a token carrying a shell metacharacter, naming the offender (INV-7)', () => {
    for (const bad of [
      'pnpm test | grep foo',
      'pnpm test > out.txt',
      'pnpm test; rm x',
      'pnpm test `whoami`',
      'pnpm test $(whoami)',
      'pnpm test --name=$FOO',
    ]) {
      const parsed = parseCommandChain(bad);
      expect(parsed.ok, bad).toBe(false);
    }
    const piped = parseCommandChain('pnpm test | grep foo');
    expect(piped.ok).toBe(false);
    if (piped.ok) return;
    expect(piped.invalidToken).toBe('|');
  });

  it('a blank command yields no steps (the caller skips it)', () => {
    const parsed = parseCommandChain('   ');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.steps).toEqual([]);
  });
});

describe('runCommandChain', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-chain-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Records every spawn and returns a fixed exit per bin. */
  function recordingShell(exitByBin: Record<string, number> = {}): {
    shell: DeliveryShell;
    spawns: CommandStep[];
  } {
    const spawns: CommandStep[] = [];
    const shell: DeliveryShell = {
      async run(bin, args) {
        spawns.push({ bin, args });
        const exitCode = exitByBin[bin] ?? 0;
        return { stdout: `${bin} ran`, stderr: exitCode === 0 ? '' : `${bin} failed`, exitCode };
      },
    };
    return { shell, spawns };
  }

  it('runs mkdir -p in-process and spawns only the real test binary (AC-1)', async () => {
    const parsed = parseCommandChain(
      'mkdir -p .paqad/test-results && ./vendor/bin/pest --log-junit .paqad/test-results/pest.xml',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { shell, spawns } = recordingShell();

    const result = await runCommandChain(shell, parsed.steps, root);

    expect(spawns).toEqual<CommandStep[]>([
      { bin: './vendor/bin/pest', args: ['--log-junit', '.paqad/test-results/pest.xml'] },
    ]);
    expect(existsSync(join(root, '.paqad/test-results'))).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('./vendor/bin/pest ran');
  });

  it('stops at the first non-zero step and returns its exit code', async () => {
    const parsed = parseCommandChain('first && second && third');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { shell, spawns } = recordingShell({ second: 2 });

    const result = await runCommandChain(shell, parsed.steps, root);

    expect(result.exitCode).toBe(2);
    expect(spawns.map((s) => s.bin)).toEqual(['first', 'second']);
    expect(result.stderr).toContain('second failed');
  });
});
