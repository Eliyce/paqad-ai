import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';

describe('delivery capability — kernel wiring (warn-floor, completion-only)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-delivery-cap-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('no-ops at the pre-mutation seam', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('never blocks at the completion seam (delivery is warn-floor)', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(false);
  });
});
