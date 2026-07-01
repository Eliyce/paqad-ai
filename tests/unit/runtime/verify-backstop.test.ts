import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Stop-hook backstop routes the verdict to the correct stream: on a BLOCK
// (exit 2) the host surfaces only STDERR to the model, so a failing verdict that
// went to stdout was invisible ("No stderr output"). These exercise the real
// runVerificationBackstop with an injected {stdout,stderr} pair and a mocked dist
// api, so the channel decision is asserted without a built dist.
const DIST = resolve(process.cwd(), 'dist/index.js');

function capture() {
  let text = '';
  return { stream: { write: (s: string) => ((text += s), true) }, read: () => text };
}

describe('runtime/scripts/verify-backstop.mjs — verdict stream routing', () => {
  let projectRoot: string;

  beforeEach(() => {
    // A fresh tmp project with no disable signal → paqad enabled → the backstop
    // runs the (mocked) gate rather than the disabled fast-path.
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-verify-backstop-'));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.doUnmock(DIST);
  });

  it('AC-1: a FAIL verdict is written to STDERR (not stdout) and exits 2', async () => {
    vi.doMock(DIST, () => ({
      runRepositoryVerification: async () => ({
        ok: false,
        summary: '✗ verification blocked — 1/3 gates failed.',
      }),
    }));
    const { runVerificationBackstop } =
      await import('../../../runtime/scripts/verify-backstop.mjs');
    const out = capture();
    const err = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(code).toBe(2);
    expect(err.read()).toContain('✗ verification blocked');
    expect(out.read()).toBe('');
  });

  it('AC-2: a PASS verdict is written to STDOUT (not stderr) and exits 0', async () => {
    vi.doMock(DIST, () => ({
      runRepositoryVerification: async () => ({
        ok: true,
        summary: '✓ verification passed — 3/3 gates.',
      }),
    }));
    const { runVerificationBackstop } =
      await import('../../../runtime/scripts/verify-backstop.mjs');
    const out = capture();
    const err = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(code).toBe(0);
    expect(out.read()).toContain('✓ verification passed');
    expect(err.read()).toBe('');
  });
});
