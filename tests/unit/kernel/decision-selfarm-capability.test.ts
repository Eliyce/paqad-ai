import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';

// The decision-pause self-arm capability is wired into CAPABILITY_IMPLS and reads the
// payload the kernel gate threads through. Its logic is unit-tested in
// tests/unit/planning/decision-selfarm.test.ts; here we prove the KERNEL wiring: the
// payload reaches the capability, and — off by default — it only mints when opted in,
// and always non-blocking (the block is the decision-pause gate's job on the next edit).
describe('decision-pause self-arm — kernel wiring (payload threading, opt-in, non-blocking)', () => {
  let root: string;
  const FORK = 'Should I reuse the existing helper or create a new one here?';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-selfarm-cap-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    // Silence the stages block-forward so only the self-arm contributes here.
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
    writeFileSync(
      join(root, 'transcript.jsonl'),
      JSON.stringify({ message: { role: 'user', content: FORK } }),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function pending(): string[] {
    const dir = join(root, '.paqad/decisions/pending');
    return existsSync(dir) ? readdirSync(dir).filter((f) => /^D-.*\.json$/.test(f)) : [];
  }

  const payload = {
    toolName: 'Edit',
    targetPath: join('src', 'a.ts'),
    transcriptPath: '', // set per-test
    sessionId: 'ses_cap',
  };

  it('does NOT mint when disabled (off by default)', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: { ...payload, transcriptPath: join(root, 'transcript.jsonl') },
    });
    expect(result.block).toBe(false);
    expect(pending()).toHaveLength(0);
  });

  it('mints a pending packet (non-blocking) when opted in and a fork is present', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { PAQAD_DECISION_SELFARM: '1' },
      payload: { ...payload, transcriptPath: join(root, 'transcript.jsonl') },
    });
    // Self-arm never blocks — it only mints; the decision-pause gate blocks the NEXT edit.
    expect(result.block).toBe(false);
    expect(result.summary).toContain('▸ paqad');
    expect(pending()).toHaveLength(1);
  });
});
