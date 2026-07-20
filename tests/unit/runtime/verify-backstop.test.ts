import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Issue #368 — the Stop-hook backstop must surface the end-of-change receipt to the
// DEVELOPER whether the verdict passes, fails, or is inconclusive (no more pass-only
// visibility). On the Claude Stop hook the developer channel is the JSON
// `{systemMessage}` on stdout at exit 0; a HARD failure additionally carries
// `{decision:'block'}` so the model keeps working (exit 2 is a no-op on a Stop hook).
// The git/CI backstop keeps the plain-text + exit-code contract. These exercise the
// real runVerificationBackstop with an injected {stdout,stderr} pair and a mocked dist
// api, so the channel decision is asserted without a built dist.
const DIST = resolve(process.cwd(), 'dist/index.js');

function capture() {
  let text = '';
  return { stream: { write: (s: string) => ((text += s), true) }, read: () => text };
}

function mockVerdict(verdict: Record<string, unknown>) {
  vi.doMock(DIST, () => ({ runRepositoryVerification: async () => verdict }));
}

async function loadBackstop() {
  return import('../../../runtime/scripts/verify-backstop.mjs');
}

describe('runtime/scripts/verify-backstop.mjs — #368 verdict surfacing', () => {
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

  it('AC-1: a HARD-FAIL verdict at hook-completion emits a visible {systemMessage} AND {decision:block}, exit 0', async () => {
    const receipt = '**▸ paqad** · Needs your attention\n> 🔴 stage-evidence: missing [review]';
    mockVerdict({
      ok: false,
      summary: 'Needs your attention — stage-evidence failed.',
      receipt,
      gates: [{ status: 'fail' }],
    });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();
    const err = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      loopActive: false,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.read());
    // The developer sees the full receipt (AC-C1 / AC-D1) …
    expect(parsed.systemMessage).toBe(receipt);
    // … and the model is told to keep working (real teeth — AC-A1).
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('Needs your attention');
    expect(parsed.reason).toContain('paqad-ai checks run');
    // Nothing leaks to stderr on the Stop hook.
    expect(err.read()).toBe('');
  });

  it('AC-2: loopActive downgrades a HARD-FAIL — still visible, but no {decision:block} (no loop)', async () => {
    const receipt = '**▸ paqad** · Needs your attention\n> 🔴 stage-evidence: missing [review]';
    mockVerdict({ ok: false, summary: 'blocked', receipt, gates: [{ status: 'fail' }] });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      loopActive: true,
      stdout: out.stream,
      stderr: capture().stream,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.read());
    expect(parsed.systemMessage).toBe(receipt); // still visible
    expect(parsed.decision).toBeUndefined(); // but does not re-block → no infinite loop
  });

  it('AC-3: an INCONCLUSIVE verdict (no failing gate) is visible but never blocks', async () => {
    const receipt = '**▸ paqad** · Inconclusive\n> 🟡 code-tests-lint: tests not verified';
    mockVerdict({
      ok: false,
      summary: 'Inconclusive',
      receipt,
      gates: [{ status: 'inconclusive' }],
    });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      loopActive: false,
      stdout: out.stream,
      stderr: capture().stream,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.read());
    expect(parsed.systemMessage).toBe(receipt);
    expect(parsed.decision).toBeUndefined(); // "do not over-trust", not "you must fix"
  });

  it('AC-4: a PASS verdict at hook-completion is a visible {systemMessage}, no block, exit 0', async () => {
    const receipt = '**▸ paqad** · Safe to merge\n> 🟢 planning — done';
    mockVerdict({ ok: true, summary: 'ignored', receipt, gates: [{ status: 'pass' }] });
    const { runVerificationBackstop } = await loadBackstop();
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
    const parsed = JSON.parse(out.read());
    expect(parsed.systemMessage).toBe(receipt);
    expect(parsed.decision).toBeUndefined();
    expect(err.read()).toBe('');
  });

  it('AC-5a: a FAIL at the git backstop stays plain-text on STDERR and exits 2 (hard gate unchanged)', async () => {
    const receipt = '**▸ paqad** · Needs your attention\n> 🔴 stage-evidence: missing [review]';
    mockVerdict({ ok: false, summary: 'blocked', receipt, gates: [{ status: 'fail' }] });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();
    const err = capture();

    const code = await runVerificationBackstop({
      origin: 'git-backstop',
      softFail: true,
      projectRoot,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(code).toBe(2);
    expect(err.read().trim()).toBe(receipt);
    expect(err.read()).not.toContain('systemMessage');
    expect(out.read()).toBe('');
  });

  it('AC-5b: a PASS at the git backstop stays plain text on STDOUT (terminal), not a systemMessage', async () => {
    const receipt = '**▸ paqad** · Safe to merge\n> 🟢 planning — done';
    mockVerdict({ ok: true, summary: 'ignored', receipt, gates: [{ status: 'pass' }] });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();

    const code = await runVerificationBackstop({
      origin: 'git-backstop',
      softFail: true,
      projectRoot,
      stdout: out.stream,
      stderr: capture().stream,
    });

    expect(code).toBe(0);
    expect(out.read().trim()).toBe(receipt);
    expect(out.read()).not.toContain('systemMessage');
  });

  it('falls back to the plain summary when no receipt was composed', async () => {
    mockVerdict({ ok: true, summary: '✓ 3/3 checks held.', gates: [{ status: 'pass' }] });
    const { runVerificationBackstop } = await loadBackstop();
    const out = capture();
    await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      stdout: out.stream,
      stderr: capture().stream,
    });
    expect(JSON.parse(out.read()).systemMessage).toBe('✓ 3/3 checks held.');
  });
});

describe('verdictHasHardFailure / blockReason helpers (#368)', () => {
  it('verdictHasHardFailure is true only when a gate reports fail', async () => {
    const { verdictHasHardFailure } = await loadBackstop();
    expect(verdictHasHardFailure({ ok: false, gates: [{ status: 'fail' }] })).toBe(true);
    expect(verdictHasHardFailure({ ok: false, gates: [{ status: 'inconclusive' }] })).toBe(false);
    expect(verdictHasHardFailure({ ok: true, gates: [{ status: 'pass' }] })).toBe(false);
  });

  it('verdictHasHardFailure falls back to !ok when no gates array is present', async () => {
    const { verdictHasHardFailure } = await loadBackstop();
    expect(verdictHasHardFailure({ ok: false })).toBe(true);
    expect(verdictHasHardFailure({ ok: true })).toBe(false);
    expect(verdictHasHardFailure(undefined)).toBe(false);
  });

  it('blockReason names the summary and the remediation', async () => {
    const { blockReason } = await loadBackstop();
    const reason = blockReason({ summary: 'Needs your attention — X failed.' });
    expect(reason).toContain('Needs your attention — X failed.');
    expect(reason).toContain('documentation_sync');
    expect(blockReason({})).toContain('A verification gate is blocking');
  });

  // Issue #409 — the voice backstop. `{systemMessage}` reaches the MODEL but not the
  // Desktop developer, which is why the receipt must be spoken by the agent and why
  // this channel is the right one for an advisory telling it to do so.
  describe('#409 narration advisory', () => {
    let projectRoot: string;

    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), 'paqad-narration-advisory-'));
      vi.resetModules();
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      vi.doUnmock(DIST);
    });

    it('threads the transcript through to the verification API', async () => {
      let seen;
      vi.doMock(DIST, () => ({
        runRepositoryVerification: async (options: Record<string, unknown>) => {
          seen = options.transcriptText;
          return { ok: true, summary: 'ok', receipt: 'ok', gates: [] };
        },
      }));
      const { runVerificationBackstop } = await loadBackstop();

      await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        transcriptText: 'the transcript',
        stdout: capture().stream,
        stderr: capture().stream,
      });

      expect(seen).toBe('the transcript');
    });

    it('passes null when the host withheld a transcript, so absence reads as "cannot tell"', async () => {
      let seen = 'unset';
      vi.doMock(DIST, () => ({
        runRepositoryVerification: async (options: Record<string, unknown>) => {
          seen = options.transcriptText as string;
          return { ok: true, summary: 'ok', receipt: 'ok', gates: [] };
        },
      }));
      const { runVerificationBackstop } = await loadBackstop();

      await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        stdout: capture().stream,
        stderr: capture().stream,
      });

      expect(seen).toBeNull();
    });

    it('AC-4: appends the advisory to the systemMessage on a GREEN verdict, without blocking', async () => {
      mockVerdict({
        ok: true,
        summary: 'Safe to merge',
        receipt: '**▸ paqad** · Safe to merge',
        gates: [{ status: 'pass' }],
        narrationAdvisory: '▸ paqad · you recorded a stage you never said out loud: review.',
      });
      const { runVerificationBackstop } = await loadBackstop();
      const out = capture();

      const code = await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        stdout: out.stream,
        stderr: capture().stream,
      });

      expect(code).toBe(0);
      const parsed = JSON.parse(out.read());
      expect(parsed.systemMessage).toContain('Safe to merge');
      expect(parsed.systemMessage).toContain('never said out loud');
      // INV-1 — a silent turn is a voice defect, not a broken change.
      expect(parsed.decision).toBeUndefined();
    });

    it('INV-1: the advisory alone never blocks, even with no other finding', async () => {
      mockVerdict({
        ok: true,
        summary: 'Safe to merge',
        receipt: 'Safe to merge',
        gates: [],
        narrationAdvisory: 'speak up',
      });
      const { runVerificationBackstop } = await loadBackstop();
      const out = capture();

      await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        stdout: out.stream,
        stderr: capture().stream,
      });

      expect(JSON.parse(out.read()).decision).toBeUndefined();
    });

    it('folds the advisory into the block reason when a real gate failure is already blocking', async () => {
      mockVerdict({
        ok: false,
        summary: 'Needs your attention',
        receipt: 'Needs your attention',
        gates: [{ status: 'fail' }],
        narrationAdvisory: '▸ paqad · you recorded stages you never said out loud: planning.',
      });
      const { runVerificationBackstop } = await loadBackstop();
      const out = capture();

      await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        stdout: out.stream,
        stderr: capture().stream,
      });

      const parsed = JSON.parse(out.read());
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('paqad-ai checks run');
      expect(parsed.reason).toContain('never said out loud');
    });

    it('leaves the receipt untouched when nothing was silent', async () => {
      const receipt = '**▸ paqad** · Safe to merge';
      mockVerdict({ ok: true, summary: 'Safe to merge', receipt, gates: [], narrationAdvisory: '' });
      const { runVerificationBackstop } = await loadBackstop();
      const out = capture();

      await runVerificationBackstop({
        origin: 'hook-completion',
        softFail: true,
        projectRoot,
        loopActive: false,
        stdout: out.stream,
        stderr: capture().stream,
      });

      expect(JSON.parse(out.read()).systemMessage).toBe(receipt);
    });
  });
});
