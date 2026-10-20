import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';

describe('resolveEffectiveLane — sensitivity floor + fail-safe', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-eff-lane-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeSensitiveModuleMap(): void {
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(
      join(root, PATHS.MODULE_MAP),
      `version: 2
modules:
  - slug: secure-core
    name: Secure Core
    sensitivity: high
    sources:
      - src/secure
`,
      'utf8',
    );
  }

  it('returns the recorded lane when the path is not high-sensitivity', () => {
    expect(resolveEffectiveLane(root, 'src/foo.ts', 'fast')).toBe('fast');
    expect(resolveEffectiveLane(root, 'src/foo.ts', 'graduated')).toBe('graduated');
  });

  it('fails safe to full for a null recorded lane', () => {
    expect(resolveEffectiveLane(root, 'src/foo.ts', null)).toBe('full');
    expect(resolveEffectiveLane(root, undefined, null)).toBe('full');
  });

  it('floors a high-sensitivity path to full even when the recorded lane is fast', () => {
    writeSensitiveModuleMap();
    expect(resolveEffectiveLane(root, 'src/secure/keys.ts', 'fast')).toBe('full');
    expect(resolveEffectiveLane(root, 'src/foo.ts', 'fast')).toBe('fast');
  });
});
