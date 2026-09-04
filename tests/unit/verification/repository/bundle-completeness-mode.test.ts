import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BUNDLE_COMPLETENESS_MODES,
  DEFAULT_BUNDLE_COMPLETENESS_MODE,
  resolveBundleCompletenessMode,
} from '@/verification/repository/bundle-completeness-mode.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-bcm-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

describe('resolveBundleCompletenessMode', () => {
  it('defaults to strict', () => {
    expect(DEFAULT_BUNDLE_COMPLETENESS_MODE).toBe('strict');
    expect(resolveBundleCompletenessMode(tempRoot(), {})).toBe('strict');
    expect(BUNDLE_COMPLETENESS_MODES).toEqual(['off', 'warn', 'strict']);
  });

  it('honours a team floor of off', () => {
    const root = tempRoot();
    write(root, '.paqad/configs/.config.policy', 'bundle_completeness=off\n');
    expect(resolveBundleCompletenessMode(root, {})).toBe('off');
  });

  it('lets the env RAISE above the team floor, never lower it', () => {
    const root = tempRoot();
    write(root, '.paqad/configs/.config.policy', 'bundle_completeness=warn\n');
    // env raising to strict wins
    expect(resolveBundleCompletenessMode(root, { PAQAD_BUNDLE_COMPLETENESS: 'strict' })).toBe(
      'strict',
    );
    // env lowering to off is clamped away — the team floor holds
    expect(resolveBundleCompletenessMode(root, { PAQAD_BUNDLE_COMPLETENESS: 'off' })).toBe('warn');
  });

  it('lets a local .config RAISE the default', () => {
    const root = tempRoot();
    write(root, '.paqad/.config', 'bundle_completeness=strict\n');
    expect(resolveBundleCompletenessMode(root, {})).toBe('strict');
  });
});
