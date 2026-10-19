import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import { DEFAULT_MUTATION_MODE, resolveMutationMode } from '@/mutation/mode.js';

// Issue #293 (Option A) — mutation_mode is a floored capability mode: off by default, the team
// value is the floor, and the local file or the env may only raise it (off < warn < strict).
describe('resolveMutationMode', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mutation-mode-'));
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const team = (value: string): void =>
    writeFileSync(join(root, '.paqad/configs/.config.policy'), `mutation_mode=${value}\n`);
  const local = (value: string): void =>
    writeFileSync(join(root, '.paqad/.config'), `mutation_mode=${value}\n`);

  it('defaults to off with nothing set', () => {
    expect(DEFAULT_MUTATION_MODE).toBe('off');
    expect(resolveMutationMode(root, {})).toBe('off');
  });

  it('AC-20: team warn with a local off stays warn', () => {
    team('warn');
    local('off');
    expect(resolveMutationMode(root, {})).toBe('warn');
  });

  it('AC-20: PAQAD_MUTATION_MODE=strict raises a team warn to strict', () => {
    team('warn');
    expect(resolveMutationMode(root, { PAQAD_MUTATION_MODE: 'strict' })).toBe('strict');
  });

  it('AC-20: team strict with the env saying off stays strict', () => {
    team('strict');
    expect(resolveMutationMode(root, { PAQAD_MUTATION_MODE: 'off' })).toBe('strict');
  });

  it('a local file may raise the off default', () => {
    local('warn');
    expect(resolveMutationMode(root, {})).toBe('warn');
  });

  it('ignores an unrecognised value instead of treating it as a mode', () => {
    team('loud');
    expect(resolveMutationMode(root, {})).toBe('off');
  });

  it('is registered once in FRAMEWORK_CONFIG_SPECS as a floored policy enum, default off', () => {
    const specs = FRAMEWORK_CONFIG_SPECS.filter((spec) => spec.key === 'mutation_mode');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      env: 'PAQAD_MUTATION_MODE',
      type: 'enum',
      enumValues: ['off', 'warn', 'strict'],
      default: 'off',
      group: 'policy',
      section: 'Enforcement (capability modes — team value is a floor)',
    });
    expect(specs[0]!.comment).toContain('verify-backstop.mjs');
    expect(specs[0]!.comment).not.toContain('—');
  });
});
