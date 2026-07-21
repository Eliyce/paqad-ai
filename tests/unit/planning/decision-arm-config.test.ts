import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DECISION_ARM_MODE,
  DEFAULT_MAX_PER_CHANGE,
  DEFAULT_PLAN_THRESHOLD,
  resolveDecisionArmConfig,
  resolveDecisionArmMode,
} from '@/planning/decision-arm-config.js';

function makeProject(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-arm-cfg-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('resolveDecisionArmConfig', () => {
  it('resolves to the shipped defaults on a bare project', () => {
    expect(resolveDecisionArmConfig(makeProject(), {})).toEqual({
      mode: DEFAULT_DECISION_ARM_MODE,
      planThreshold: DEFAULT_PLAN_THRESHOLD,
      maxPerChange: DEFAULT_MAX_PER_CHANGE,
    });
  });

  it('ships warn, not strict — a minted packet blocks edits, so arming bakes in first', () => {
    expect(DEFAULT_DECISION_ARM_MODE).toBe('warn');
  });

  it('reads team values from configs/.config.*', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': [
        'decision_arm_mode=strict',
        'decision_arm_plan_threshold=0.7',
        'decision_arm_max_per_change=3',
      ].join('\n'),
    });
    expect(resolveDecisionArmConfig(root, {})).toEqual({
      mode: 'strict',
      planThreshold: 0.7,
      maxPerChange: 3,
    });
  });

  it('lets the local file RAISE the team mode', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': 'decision_arm_mode=warn',
      '.paqad/.config': 'decision_arm_mode=strict',
    });
    expect(resolveDecisionArmMode(root, {})).toBe('strict');
  });

  it('clamps a local attempt to LOWER the team mode', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': 'decision_arm_mode=strict',
      '.paqad/.config': 'decision_arm_mode=off',
    });
    expect(resolveDecisionArmMode(root, {})).toBe('strict');
  });

  it('lets the env raise but not lower', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'decision_arm_mode=warn' });
    expect(resolveDecisionArmMode(root, { PAQAD_DECISION_ARM_MODE: 'strict' })).toBe('strict');
    expect(resolveDecisionArmMode(root, { PAQAD_DECISION_ARM_MODE: 'off' })).toBe('warn');
  });

  it('falls back to the default on an unparseable or out-of-range number', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': [
        'decision_arm_plan_threshold=nonsense',
        'decision_arm_max_per_change=-4',
      ].join('\n'),
    });
    const config = resolveDecisionArmConfig(root, {});
    expect(config.planThreshold).toBe(DEFAULT_PLAN_THRESHOLD);
    expect(config.maxPerChange).toBe(DEFAULT_MAX_PER_CHANGE);
  });

  it('rejects a threshold above 1', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': 'decision_arm_plan_threshold=1.5',
    });
    expect(resolveDecisionArmConfig(root, {}).planThreshold).toBe(DEFAULT_PLAN_THRESHOLD);
  });

  it('accepts a max of 0 (arm nothing, but keep reporting)', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'decision_arm_max_per_change=0' });
    expect(resolveDecisionArmConfig(root, {}).maxPerChange).toBe(0);
  });

  it('ignores an unrecognised mode rather than silently disabling arming', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'decision_arm_mode=lenient' });
    expect(resolveDecisionArmMode(root, {})).toBe(DEFAULT_DECISION_ARM_MODE);
  });
});
