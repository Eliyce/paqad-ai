import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';

// The delivery capability is wired into CAPABILITY_IMPLS through the real kernel gate.
// Its behaviour (branch/CI checks) is unit-tested with an injected runner in
// tests/unit/delivery/delivery-check.test.ts; here we pin the KERNEL wiring: delivery
// evaluates only at completion, and — being warn-floor — never blocks the host.
describe('delivery capability — kernel wiring (warn-floor, completion-only)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-delivery-cap-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    // Turn stages off so the pre-mutation seam is clean of the block-forward gate,
    // isolating the delivery capability's own contribution.
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('no-ops at the pre-mutation seam', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('never blocks at the completion seam (delivery is warn-floor)', async () => {
    // Whatever git reports for this temp path, delivery is mandatory:false, so the
    // gate must never return a blocking outcome from it.
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(false);
  });
});
