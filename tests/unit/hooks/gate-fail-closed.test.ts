import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateFailureMessage } from '../../../runtime/hooks/lib/gate-failure.mjs';

// Issue #615 (Part 6) — the three pre-mutation edit gates fail CLOSED: an unexpected exception
// blocks the edit (exit 2) with a doctor-pointing message instead of being swallowed.

const DISABLED_MOD = '../../../runtime/hooks/lib/paqad-disabled.mjs';

/** Force the shared resolver to throw, so the gate's wrapper catch fires. */
function mockResolverThrows() {
  vi.doMock(DISABLED_MOD, async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      resolveProjectRoot: () => {
        throw new Error('kaboom');
      },
    };
  });
}

function captureStderr() {
  const out: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  return { text: () => out.join(''), restore: () => spy.mockRestore() };
}

describe('gateFailureMessage', () => {
  it('names the gate, the error, and the two remedies', () => {
    const msg = gateFailureMessage('agent-entry', new Error('boom'));
    expect(msg).toContain('paqad could not run its agent-entry check (boom)');
    expect(msg).toContain('Run "npx paqad-ai doctor" to repair the install');
    expect(msg).toContain('PAQAD_DISABLED=1');
  });

  it('stringifies a non-Error throw', () => {
    expect(gateFailureMessage('capability', 'plain string')).toContain('(plain string)');
  });
});

describe('edit gates fail closed on an unexpected throw (issue #615, Part 6)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('agent-entry-gate blocks the edit (exit 2) with the doctor message', async () => {
    vi.resetModules();
    mockResolverThrows();
    const { main } = await import('../../../runtime/hooks/agent-entry-gate.mjs');
    const cap = captureStderr();
    const code = main('{}');
    cap.restore();
    expect(code).toBe(2);
    expect(cap.text()).toContain('agent-entry');
    expect(cap.text()).toContain('npx paqad-ai doctor');
    vi.doUnmock(DISABLED_MOD);
  });

  it('decision-pause-gate blocks the edit (exit 2) with the doctor message', async () => {
    vi.resetModules();
    mockResolverThrows();
    const { main } = await import('../../../runtime/hooks/decision-pause-gate.mjs');
    const cap = captureStderr();
    const code = main('{}');
    cap.restore();
    expect(code).toBe(2);
    expect(cap.text()).toContain('decision-pause');
    expect(cap.text()).toContain('npx paqad-ai doctor');
    vi.doUnmock(DISABLED_MOD);
  });

  it('capability-gate blocks on pre-mutation (exit 2) but soft-fails on completion (exit 0)', async () => {
    vi.resetModules();
    mockResolverThrows();
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const cap = captureStderr();
    const blocked = await main('{}', 'pre-mutation');
    const text = cap.text();
    const soft = await main('{}', 'completion');
    cap.restore();
    expect(blocked).toBe(2);
    expect(text).toContain('capability');
    expect(text).toContain('npx paqad-ai doctor');
    expect(soft).toBe(0);
    vi.doUnmock(DISABLED_MOD);
  });
});
