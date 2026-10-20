import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveChecksFlakyMode } from '@/checks/flaky-mode.js';

describe('resolveChecksFlakyMode', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-flakymode-'));
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('defaults to warn with nothing set', () => {
    expect(resolveChecksFlakyMode(root, {})).toBe('warn');
  });

  it('honors a team floor of fail', () => {
    writeFileSync(
      join(root, '.paqad/configs/.config.policy'),
      'checks_flaky_under_parallel=fail\n',
    );
    expect(resolveChecksFlakyMode(root, {})).toBe('fail');
  });

  it('local/env may raise the mode but not lower it below the team floor', () => {
    writeFileSync(
      join(root, '.paqad/configs/.config.policy'),
      'checks_flaky_under_parallel=warn\n',
    );
    expect(resolveChecksFlakyMode(root, { PAQAD_CHECKS_FLAKY_UNDER_PARALLEL: 'fail' })).toBe(
      'fail',
    );
    writeFileSync(join(root, '.paqad/.config'), 'checks_flaky_under_parallel=pass\n');
    expect(resolveChecksFlakyMode(root, {})).toBe('warn');
  });
});
