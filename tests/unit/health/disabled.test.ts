import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';

// Issue #220 — `paqad-ai doctor` must report a deliberate disable as a healthy
// "vanilla mode" state, not a fault.

/** The durable local off-signal: PAQAD_ENABLED=false in `.paqad/.config`. */
const DISABLED_CONFIG = 'PAQAD_ENABLED=false\n';

describe('doctor reports the disabled (vanilla) state as healthy', () => {
  let root: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-doctor-disabled-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    originalEnv = process.env.PAQAD_DISABLED;
    delete process.env.PAQAD_DISABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PAQAD_DISABLED;
    } else {
      process.env.PAQAD_DISABLED = originalEnv;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('marks "Stable framework paths only" as a pass with a vanilla-mode message (.config flag)', async () => {
    writeFileSync(join(root, '.paqad/.config'), DISABLED_CONFIG);

    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Stable framework paths only');

    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('disabled (vanilla mode)');
  });

  it('marks the same check disabled via the PAQAD_DISABLED env override', async () => {
    process.env.PAQAD_DISABLED = '1';

    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Stable framework paths only');

    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('vanilla mode');
  });
});
